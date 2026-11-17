use crate::err;
use crate::lsp::login_path;
use serde::Serialize;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::mpsc;
use std::time::Duration;

#[derive(Serialize)]
pub struct Formatted {
    content: String,
    tools: Vec<String>,
    warning: Option<String>,
}

fn find_bin(file: &Path, root: &Path, name: &str) -> Option<(PathBuf, PathBuf)> {
    let mut dir = file.parent();
    while let Some(d) = dir {
        let bin = d.join("node_modules/.bin").join(name);
        if bin.is_file() {
            return Some((bin, d.to_path_buf()));
        }
        if d == root || !d.starts_with(root) {
            break;
        }
        dir = d.parent();
    }
    None
}

fn run(bin: &Path, cwd: &Path, args: &[&str], input: &str) -> Result<(bool, String, String), String> {
    let path_env = std::env::join_paths(login_path()).map_err(err)?;
    let mut child = Command::new(bin)
        .args(args)
        .current_dir(cwd)
        .env("PATH", path_env)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(err)?;
    let mut stdin = child.stdin.take().ok_or("no stdin")?;
    let mut stdout = child.stdout.take().ok_or("no stdout")?;
    let mut stderr = child.stderr.take().ok_or("no stderr")?;
    let data = input.to_string();
    std::thread::spawn(move || {
        let _ = stdin.write_all(data.as_bytes());
    });
    let err_reader = std::thread::spawn(move || {
        let mut s = String::new();
        let _ = stderr.read_to_string(&mut s);
        s
    });
    let (tx, rx) = mpsc::channel();
    std::thread::spawn(move || {
        let mut s = String::new();
        let _ = stdout.read_to_string(&mut s);
        let _ = tx.send(s);
    });
    let out = match rx.recv_timeout(Duration::from_secs(15)) {
        Ok(s) => s,
        Err(_) => {
            let _ = child.kill();
            return Err(format!("{} timed out", bin.file_name().unwrap_or_default().to_string_lossy()));
        }
    };
    let status = child.wait().map_err(err)?;
    let stderr = err_reader.join().unwrap_or_default();
    Ok((status.success(), out, stderr))
}

fn first_line(s: &str) -> String {
    s.lines().map(str::trim).find(|l| !l.is_empty()).unwrap_or("").chars().take(200).collect()
}

fn eslint_fix(file: &Path, root: &Path, content: &str) -> Result<Option<String>, String> {
    let Some((bin, cwd)) = find_bin(file, root, "eslint") else { return Ok(None) };
    let path = file.to_string_lossy();
    let (_, out, stderr) = run(
        &bin,
        &cwd,
        &["--stdin", "--stdin-filename", &path, "--fix-dry-run", "--format", "json"],
        content,
    )?;
    let parsed: serde_json::Value = serde_json::from_str(&out).map_err(|_| format!("ESLint: {}", first_line(&stderr)))?;
    Ok(parsed
        .get(0)
        .and_then(|r| r.get("output"))
        .and_then(|o| o.as_str())
        .map(str::to_string))
}

fn prettier(file: &Path, root: &Path, content: &str) -> Result<Option<String>, String> {
    let Some((bin, cwd)) = find_bin(file, root, "prettier") else { return Ok(None) };
    let path = file.to_string_lossy();
    let (ok, out, stderr) = run(&bin, &cwd, &["--stdin-filepath", &path], content)?;
    if ok {
        return Ok(Some(out));
    }
    if stderr.contains("No parser could be inferred") {
        return Ok(None);
    }
    Err(format!("Prettier: {}", first_line(&stderr.replace("[error]", ""))))
}

#[tauri::command]
pub async fn format_file(path: String, root: String, content: String, eslint: bool) -> Result<Formatted, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let file = PathBuf::from(&path);
        let root = PathBuf::from(&root);
        let mut text = content;
        let mut tools = Vec::new();
        let mut warning = None;
        if eslint {
            match eslint_fix(&file, &root, &text) {
                Ok(Some(next)) => {
                    text = next;
                    tools.push("ESLint".to_string());
                }
                Ok(None) => {}
                Err(e) => warning = Some(e),
            }
        }
        match prettier(&file, &root, &text) {
            Ok(Some(next)) => {
                text = next;
                tools.push("Prettier".to_string());
            }
            Ok(None) => {}
            Err(e) => warning = Some(e),
        }
        Formatted { content: text, tools, warning }
    })
    .await
    .map_err(err)
}
