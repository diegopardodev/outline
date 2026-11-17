mod format;
mod git;
mod logs;
mod lsp;
mod pty;
mod search;
mod settings;

use notify::RecursiveMode;
use notify_debouncer_mini::{new_debouncer, DebounceEventResult, Debouncer};
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Duration;
use tauri::menu::{MenuBuilder, MenuItemBuilder, SubmenuBuilder};
use tauri::{AppHandle, Emitter, Manager, State};

pub(crate) const NOISY_DIRS: &[&str] = &[".git", "node_modules", "target", "dist", ".next", ".turbo", ".svelte-kit"];
const HIDDEN_NAMES: &[&str] = &[".git", ".DS_Store"];
const MAX_FILE_BYTES: u64 = 20 * 1024 * 1024;
const MAX_LISTED_FILES: usize = 50_000;

#[derive(Serialize)]
struct Entry {
    name: String,
    path: String,
    is_dir: bool,
}

#[derive(Default)]
struct WatchState(Mutex<Option<Debouncer<notify::RecommendedWatcher>>>);

pub(crate) fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

pub(crate) fn walker(root: &Path) -> ignore::Walk {
    ignore::WalkBuilder::new(root)
        .hidden(false)
        .git_ignore(true)
        .git_global(true)
        .require_git(false)
        .filter_entry(|e| {
            let name = e.file_name().to_string_lossy();
            !(e.file_type().map(|t| t.is_dir()).unwrap_or(false) && NOISY_DIRS.contains(&name.as_ref()))
        })
        .build()
}

#[tauri::command]
fn read_dir(path: String) -> Result<Vec<Entry>, String> {
    let mut entries: Vec<Entry> = fs::read_dir(&path)
        .map_err(err)?
        .filter_map(|e| e.ok())
        .filter_map(|e| {
            let name = e.file_name().to_string_lossy().to_string();
            if HIDDEN_NAMES.contains(&name.as_str()) {
                return None;
            }
            let ft = e.file_type().ok();
            let is_dir = ft.map(|t| t.is_dir()).unwrap_or(false)
                || (ft.map(|t| t.is_symlink()).unwrap_or(false) && e.path().is_dir());
            Some(Entry {
                name,
                path: e.path().to_string_lossy().to_string(),
                is_dir,
            })
        })
        .collect();
    entries.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    Ok(entries)
}

#[tauri::command]
fn read_file(path: String) -> Result<String, String> {
    let meta = fs::metadata(&path).map_err(err)?;
    if meta.len() > MAX_FILE_BYTES {
        return Err("File is too large (over 20 MB).".into());
    }
    let bytes = fs::read(&path).map_err(err)?;
    if bytes.iter().take(8000).any(|b| *b == 0) {
        return Err("Binary file: cannot open as text.".into());
    }
    String::from_utf8(bytes).map_err(|_| "File is not valid UTF-8.".into())
}

#[tauri::command]
fn read_bytes(path: String) -> Result<tauri::ipc::Response, String> {
    let meta = fs::metadata(&path).map_err(err)?;
    if meta.len() > 64 * 1024 * 1024 {
        return Err("File is too large to preview (over 64 MB).".into());
    }
    fs::read(&path).map(tauri::ipc::Response::new).map_err(err)
}

#[tauri::command]
fn write_file(path: String, content: String) -> Result<(), String> {
    fs::write(&path, content).map_err(err)
}

#[tauri::command]
fn create_file(path: String) -> Result<(), String> {
    let p = Path::new(&path);
    if p.exists() {
        return Err("A file with that name already exists.".into());
    }
    if let Some(parent) = p.parent() {
        fs::create_dir_all(parent).map_err(err)?;
    }
    fs::write(p, "").map_err(err)
}

#[tauri::command]
fn create_dir(path: String) -> Result<(), String> {
    if Path::new(&path).exists() {
        return Err("A folder with that name already exists.".into());
    }
    fs::create_dir_all(&path).map_err(err)
}

#[tauri::command]
fn rename_path(from: String, to: String) -> Result<(), String> {
    if Path::new(&to).exists() {
        return Err("An item with that name already exists.".into());
    }
    fs::rename(&from, &to).map_err(err)
}

#[tauri::command]
fn delete_path(path: String) -> Result<(), String> {
    trash::delete(&path).map_err(err)
}

#[tauri::command]
async fn list_files(root: String) -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root_path = PathBuf::from(&root);
        let mut out = Vec::new();
        for entry in walker(&root_path).flatten() {
            if !entry.file_type().map(|t| t.is_file()).unwrap_or(false) || entry.file_name() == ".DS_Store" {
                continue;
            }
            if let Ok(rel) = entry.path().strip_prefix(&root_path) {
                out.push(rel.to_string_lossy().to_string());
            }
            if out.len() >= MAX_LISTED_FILES {
                break;
            }
        }
        out
    })
    .await
    .map_err(err)
}

#[tauri::command]
fn watch_root(app: AppHandle, state: State<WatchState>, root: String) -> Result<(), String> {
    let mut guard = state.0.lock().map_err(err)?;
    *guard = None;

    let handle = app.clone();
    let mut debouncer = new_debouncer(Duration::from_millis(250), move |res: DebounceEventResult| {
        let Ok(events) = res else { return };
        let mut git_touched = false;
        let paths: Vec<String> = events
            .into_iter()
            .filter(|e| {
                let noisy = e.path.components().any(|c| {
                    let s = c.as_os_str().to_string_lossy();
                    NOISY_DIRS.contains(&s.as_ref())
                });
                if noisy && e.path.components().any(|c| c.as_os_str() == ".git") {
                    git_touched = true;
                }
                !noisy
            })
            .map(|e| e.path.to_string_lossy().to_string())
            .collect();
        if !paths.is_empty() {
            let _ = handle.emit("fs-change", paths);
        } else if git_touched {
            let _ = handle.emit("git-change", ());
        }
    })
    .map_err(err)?;
    debouncer.watcher().watch(Path::new(&root), RecursiveMode::Recursive).map_err(err)?;
    *guard = Some(debouncer);
    Ok(())
}

#[tauri::command]
fn reveal_in_finder(path: String) -> Result<(), String> {
    std::process::Command::new("open").arg("-R").arg(&path).spawn().map_err(err)?;
    Ok(())
}

#[derive(Default)]
struct LaunchPath(Mutex<Option<String>>);

#[derive(Serialize, Clone)]
struct OpenRequest {
    path: String,
    is_dir: bool,
}

fn launch_target(args: &[String], cwd: Option<&str>) -> Option<OpenRequest> {
    let raw = args.iter().skip(1).find(|a| !a.starts_with('-'))?;
    let mut path = PathBuf::from(raw);
    if path.is_relative() {
        if let Some(cwd) = cwd {
            path = Path::new(cwd).join(path);
        }
    }
    let path = fs::canonicalize(&path).ok()?;
    Some(OpenRequest { is_dir: path.is_dir(), path: path.to_string_lossy().into_owned() })
}

#[tauri::command]
fn take_launch_path(state: State<LaunchPath>) -> Option<OpenRequest> {
    let path = state.0.lock().ok()?.take()?;
    let p = Path::new(&path);
    Some(OpenRequest { is_dir: p.is_dir(), path })
}

#[derive(Default)]
struct QuitState {
    allowed: AtomicBool,
    pending: AtomicBool,
    acked: AtomicBool,
}

fn request_quit(app: &AppHandle) {
    let state = app.state::<QuitState>();
    if state.pending.swap(true, Ordering::SeqCst) {
        let _ = app.emit("quit-requested", ());
        return;
    }
    state.acked.store(false, Ordering::SeqCst);
    let _ = app.emit("quit-requested", ());
    let handle = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(2000));
        let state = handle.state::<QuitState>();
        if !state.acked.load(Ordering::SeqCst) {
            logs::append("warn", "quit not acknowledged by the webview; exiting");
            state.allowed.store(true, Ordering::SeqCst);
            handle.exit(0);
        }
    });
}

#[tauri::command]
fn quit_ack(state: State<QuitState>, cancelled: bool) {
    state.acked.store(true, Ordering::SeqCst);
    if cancelled {
        state.pending.store(false, Ordering::SeqCst);
    }
}

#[tauri::command]
fn quit_app(app: AppHandle, state: State<QuitState>) {
    state.allowed.store(true, Ordering::SeqCst);
    app.exit(0);
}

#[tauri::command]
fn open_external(url: String) -> Result<(), String> {
    if !(url.starts_with("http://") || url.starts_with("https://")) {
        return Err("Only http(s) links can be opened.".into());
    }
    std::process::Command::new("open").arg(&url).spawn().map_err(err)?;
    Ok(())
}

pub fn run() {
    logs::install_panic_hook();
    logs::append("info", &format!("Outline {} starting", env!("CARGO_PKG_VERSION")));
    let launch = launch_target(&std::env::args().collect::<Vec<_>>(), None).map(|r| r.path);
    let builder = tauri::Builder::default();
    #[cfg(not(debug_assertions))]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
        if let Some(request) = launch_target(&args, Some(&cwd)) {
            let _ = app.emit("open-path", request);
        }
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.unminimize();
            let _ = window.show();
            let _ = window.set_focus();
        }
    }));
    builder
        .plugin(tauri_plugin_dialog::init())
        .manage(LaunchPath(Mutex::new(launch)))
        .manage(WatchState::default())
        .manage(pty::Ptys::default())
        .manage(lsp::Servers::default())
        .manage(QuitState::default())
        .on_menu_event(|app, event| {
            if event.id() == "quit" {
                request_quit(app);
            }
        })
        .setup(|app| {
            let app_menu = SubmenuBuilder::new(app, "Outline")
                .about(None)
                .separator()
                .services()
                .separator()
                .hide()
                .hide_others()
                .show_all()
                .separator()
                .item(&MenuItemBuilder::with_id("quit", "Quit Outline").accelerator("CmdOrCtrl+Q").build(app)?)
                .build()?;
            let edit_menu = SubmenuBuilder::new(app, "Edit")
                .undo()
                .redo()
                .separator()
                .cut()
                .copy()
                .paste()
                .select_all()
                .build()?;
            let window_menu = SubmenuBuilder::new(app, "Window")
                .minimize()
                .maximize()
                .separator()
                .fullscreen()
                .build()?;
            let menu = MenuBuilder::new(app).items(&[&app_menu, &edit_menu, &window_menu]).build()?;
            app.set_menu(menu)?;

            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_focus();
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            read_dir,
            take_launch_path,
            read_file,
            read_bytes,
            write_file,
            create_file,
            create_dir,
            rename_path,
            delete_path,
            list_files,
            watch_root,
            reveal_in_finder,
            open_external,
            logs::log_line,
            logs::log_path,
            settings::settings_path,
            settings::read_settings,
            format::format_file,
            quit_ack,
            quit_app,
            search::search_project,
            search::replace_in_text,
            search::replace_in_files,
            git::git_status,
            git::git_show,
            git::git_stage,
            git::git_unstage,
            git::git_discard,
            git::git_commit,
            git::git_push,
            git::git_pull,
            git::git_fetch,
            pty::pty_spawn,
            pty::pty_write,
            pty::pty_resize,
            pty::pty_kill,
            lsp::lsp_start,
            lsp::lsp_send,
            lsp::lsp_stop
        ])
        .build(tauri::generate_context!())
        .expect("error while building Outline")
        .run(|app, event| match event {
            tauri::RunEvent::ExitRequested { code, api, .. } => {
                let allowed = app.state::<QuitState>().allowed.load(Ordering::SeqCst);
                if !allowed && code.is_some() && !app.webview_windows().is_empty() {
                    api.prevent_exit();
                    request_quit(app);
                }
            }
            tauri::RunEvent::Exit => {
                logs::append("info", "exit");
                lsp::stop_all(&app.state::<lsp::Servers>());
            }
            _ => {}
        });
}
