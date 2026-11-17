use crate::err;
use serde::Serialize;
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::{Mutex, OnceLock};
use tauri::ipc::Channel;
use tauri::{AppHandle, Manager, State};

struct Server {
    child: Child,
    stdin: ChildStdin,
}

#[derive(Default)]
pub struct Servers(Mutex<HashMap<u32, Server>>);

#[derive(Serialize, Clone)]
#[serde(tag = "kind", content = "data")]
pub enum LspEvent {
    Message(String),
    Exit,
}

pub(crate) fn login_path() -> &'static Vec<PathBuf> {
    static PATH: OnceLock<Vec<PathBuf>> = OnceLock::new();
    PATH.get_or_init(|| {
        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".into());
        let out = Command::new(shell)
            .args(["-ilc", "printf '__OUTLINE__%s__OUTLINE__' \"$PATH\""])
            .stdin(Stdio::null())
            .stderr(Stdio::null())
            .output()
            .ok()
            .map(|o| String::from_utf8_lossy(&o.stdout).to_string())
            .unwrap_or_default();
        let from_shell = out.split("__OUTLINE__").nth(1).unwrap_or("").to_string();
        let inherited = std::env::var("PATH").unwrap_or_default();
        let mut dirs: Vec<PathBuf> = Vec::new();
        let home = std::env::var("HOME").unwrap_or_default();
        let extra = [
            format!("{home}/.cargo/bin"),
            format!("{home}/.local/bin"),
            "/opt/homebrew/bin".into(),
            "/usr/local/bin".into(),
            "/usr/bin".into(),
        ];
        for d in from_shell.split(':').chain(inherited.split(':')).chain(extra.iter().map(|s| s.as_str())) {
            if d.is_empty() {
                continue;
            }
            let p = PathBuf::from(d);
            if !dirs.contains(&p) {
                dirs.push(p);
            }
        }
        dirs
    })
}

fn which(name: &str) -> Option<PathBuf> {
    login_path().iter().map(|d| d.join(name)).find(|p| p.is_file())
}

fn works(bin: &Path, probe: &[&str]) -> bool {
    Command::new(bin)
        .args(probe)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

fn platform_pkg() -> String {
    let arch = if cfg!(target_arch = "aarch64") { "arm64" } else { "x64" };
    format!("darwin-{arch}")
}

fn native_tsc(node_modules: &Path) -> Option<PathBuf> {
    let pkg = node_modules.join("typescript");
    let manifest = std::fs::read_to_string(pkg.join("package.json")).ok()?;
    let json: serde_json::Value = serde_json::from_str(&manifest).ok()?;
    let major: u32 = json["version"].as_str()?.split('.').next()?.parse().ok()?;
    if major < 7 {
        return None;
    }
    let plat = format!("typescript-{}", platform_pkg());
    let real = std::fs::canonicalize(&pkg).ok()?;
    let candidates = [
        real.parent()?.join("@typescript").join(&plat).join("lib/tsc"),
        node_modules.join("@typescript").join(&plat).join("lib/tsc"),
    ];
    candidates.into_iter().find(|p| p.is_file())
}

fn find_typescript(app: &AppHandle, root: &Path) -> Option<PathBuf> {
    let mut dir = Some(root);
    while let Some(d) = dir {
        if let Some(p) = native_tsc(&d.join("node_modules")) {
            return Some(p);
        }
        dir = d.parent();
    }
    let bundled = app.path().app_data_dir().ok()?.join("servers/node_modules");
    native_tsc(&bundled)
}

fn first_available(options: &[(&str, &[&str])]) -> Option<(PathBuf, Vec<String>)> {
    options.iter().find_map(|(name, args)| {
        which(name).map(|p| (p, args.iter().map(|s| s.to_string()).collect()))
    })
}

fn resolve(app: &AppHandle, server: &str, root: &Path) -> Option<(PathBuf, Vec<String>)> {
    match server {
        "typescript" => find_typescript(app, root).map(|p| (p, vec!["--lsp".into(), "--stdio".into()])),
        "rust" => which("rust-analyzer").filter(|p| works(p, &["--version"])).map(|p| (p, vec![])),
        "swift" => first_available(&[("sourcekit-lsp", &[])]),
        "c" => first_available(&[("clangd", &[])]),
        "go" => first_available(&[("gopls", &[])]),
        "python" => first_available(&[
            ("basedpyright-langserver", &["--stdio"]),
            ("pyright-langserver", &["--stdio"]),
            ("pylsp", &[]),
        ]),
        "css" => first_available(&[("vscode-css-language-server", &["--stdio"])]),
        "html" => first_available(&[("vscode-html-language-server", &["--stdio"])]),
        "json" => first_available(&[("vscode-json-language-server", &["--stdio"])]),
        _ => None,
    }
}

fn read_message(reader: &mut impl BufRead) -> Option<String> {
    let mut length: Option<usize> = None;
    loop {
        let mut line = String::new();
        if reader.read_line(&mut line).ok()? == 0 {
            return None;
        }
        let line = line.trim_end();
        if line.is_empty() {
            if length.is_some() {
                break;
            }
            continue;
        }
        if let Some((key, value)) = line.split_once(':') {
            if key.eq_ignore_ascii_case("content-length") {
                length = value.trim().parse().ok();
            }
        }
    }
    let mut body = vec![0u8; length?];
    reader.read_exact(&mut body).ok()?;
    Some(String::from_utf8_lossy(&body).into_owned())
}

#[tauri::command]
pub fn lsp_start(
    app: AppHandle,
    state: State<Servers>,
    id: u32,
    server: String,
    root: String,
    on_event: Channel<LspEvent>,
) -> Result<(), String> {
    let root_path = PathBuf::from(&root);
    let (bin, args) = resolve(&app, &server, &root_path).ok_or_else(|| "unavailable".to_string())?;
    let path_env = std::env::join_paths(login_path()).map_err(err)?;
    let mut child = Command::new(&bin)
        .args(&args)
        .current_dir(&root_path)
        .env("PATH", path_env)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(err)?;
    let stdin = child.stdin.take().ok_or("no stdin")?;
    let stdout = child.stdout.take().ok_or("no stdout")?;
    std::thread::spawn(move || {
        let mut reader = BufReader::new(stdout);
        while let Some(msg) = read_message(&mut reader) {
            if on_event.send(LspEvent::Message(msg)).is_err() {
                break;
            }
        }
        let _ = on_event.send(LspEvent::Exit);
    });
    state.0.lock().map_err(err)?.insert(id, Server { child, stdin });
    Ok(())
}

#[tauri::command]
pub fn lsp_send(state: State<Servers>, id: u32, message: String) -> Result<(), String> {
    let mut servers = state.0.lock().map_err(err)?;
    let server = servers.get_mut(&id).ok_or("server not running")?;
    let header = format!("Content-Length: {}\r\n\r\n", message.len());
    server.stdin.write_all(header.as_bytes()).map_err(err)?;
    server.stdin.write_all(message.as_bytes()).map_err(err)?;
    server.stdin.flush().map_err(err)
}

#[tauri::command]
pub fn lsp_stop(state: State<Servers>, id: u32) -> Result<(), String> {
    if let Some(mut server) = state.0.lock().map_err(err)?.remove(&id) {
        drop(server.stdin);
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_millis(1500));
            let _ = server.child.kill();
            let _ = server.child.wait();
        });
    }
    Ok(())
}

pub fn stop_all(state: &Servers) {
    if let Ok(mut servers) = state.0.lock() {
        for (_, mut s) in servers.drain() {
            let _ = s.child.kill();
            let _ = s.child.wait();
        }
    }
}
