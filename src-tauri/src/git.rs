use crate::err;
use crate::lsp::login_path;
use serde::Serialize;
use std::path::Path;
use std::process::{Command, Stdio};

#[derive(Serialize, Default)]
pub struct GitEntry {
    path: String,
    x: String,
    y: String,
}

#[derive(Serialize, Default)]
pub struct GitStatus {
    branch: Option<String>,
    top: Option<String>,
    upstream: Option<String>,
    ahead: u32,
    behind: u32,
    changes: Vec<(String, String)>,
    entries: Vec<GitEntry>,
}

fn command(root: &str) -> Command {
    let mut cmd = Command::new("git");
    cmd.arg("-C")
        .arg(root)
        .env("GIT_OPTIONAL_LOCKS", "0")
        .env("GIT_TERMINAL_PROMPT", "0")
        .stdin(Stdio::null());
    if let Ok(path) = std::env::join_paths(login_path()) {
        cmd.env("PATH", path);
    }
    if std::env::var_os("GIT_SSH_COMMAND").is_none() {
        cmd.env("GIT_SSH_COMMAND", "ssh -o BatchMode=yes");
    }
    cmd
}

fn git(root: &str, args: &[&str]) -> Option<String> {
    let out = command(root).args(args).output().ok()?;
    if !out.status.success() {
        return None;
    }
    Some(String::from_utf8_lossy(&out.stdout).to_string())
}

fn git_checked(root: &str, args: &[&str]) -> Result<String, String> {
    let out = command(root).args(args).output().map_err(err)?;
    let stdout = String::from_utf8_lossy(&out.stdout).to_string();
    if out.status.success() {
        return Ok(stdout);
    }
    let stderr = String::from_utf8_lossy(&out.stderr).to_string();
    let msg = stderr
        .lines()
        .chain(stdout.lines())
        .map(|l| l.trim().trim_start_matches("error: ").trim_start_matches("fatal: "))
        .filter(|l| !l.is_empty() && !l.starts_with("hint:"))
        .take(3)
        .collect::<Vec<_>>()
        .join(" ");
    Err(if msg.is_empty() { format!("git {} failed", args.first().unwrap_or(&"")) } else { msg })
}

fn code(xy: &str) -> &'static str {
    if xy == "??" {
        return "U";
    }
    if xy.contains('U') || xy == "AA" || xy == "DD" {
        return "C";
    }
    if xy.contains('D') {
        return "D";
    }
    if xy.contains('A') {
        return "A";
    }
    if xy.contains('R') {
        return "R";
    }
    "M"
}

fn parse_branch(root: &str, rest: &str, status: &mut GitStatus) {
    if let Some(b) = rest.strip_prefix("No commits yet on ") {
        status.branch = Some(b.to_string());
        return;
    }
    if rest.starts_with("HEAD (no branch)") {
        status.branch = Some(git(root, &["rev-parse", "--short", "HEAD"]).unwrap_or_default().trim().to_string());
        return;
    }
    let (head, tracking) = match rest.split_once(" [") {
        Some((h, t)) => (h, Some(t.trim_end_matches(']'))),
        None => (rest, None),
    };
    let mut names = head.splitn(2, "...");
    status.branch = names.next().map(str::to_string);
    status.upstream = names.next().map(str::to_string);
    if let Some(t) = tracking {
        for part in t.split(", ") {
            if let Some(n) = part.strip_prefix("ahead ") {
                status.ahead = n.parse().unwrap_or(0);
            } else if let Some(n) = part.strip_prefix("behind ") {
                status.behind = n.parse().unwrap_or(0);
            }
        }
    }
}

#[tauri::command]
pub async fn git_status(root: String) -> Result<GitStatus, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let Some(top) = git(&root, &["rev-parse", "--show-toplevel"]) else {
            return GitStatus::default();
        };
        let top = top.trim().to_string();
        let Some(out) = git(&root, &["status", "--porcelain=v1", "-z", "-b", "--untracked-files=all"]) else {
            return GitStatus::default();
        };
        let mut status = GitStatus { top: Some(top.clone()), ..Default::default() };
        let mut parts = out.split('\0').filter(|s| !s.is_empty());
        while let Some(entry) = parts.next() {
            if let Some(rest) = entry.strip_prefix("## ") {
                parse_branch(&root, rest, &mut status);
                continue;
            }
            if entry.len() < 4 {
                continue;
            }
            let xy = &entry[..2];
            let rel = entry[3..].trim_end_matches('/');
            if xy.starts_with('R') || xy.starts_with('C') {
                parts.next();
            }
            let abs = format!("{}/{}", top, rel);
            status.changes.push((abs.clone(), code(xy).to_string()));
            status.entries.push(GitEntry { path: abs, x: xy[..1].to_string(), y: xy[1..].to_string() });
        }
        status
    })
    .await
    .map_err(err)
}

fn rel_to_top(root: &str, path: &str) -> Option<String> {
    let top = git(root, &["rev-parse", "--show-toplevel"])?;
    let top = top.trim();
    Path::new(path).strip_prefix(top).ok().map(|p| p.to_string_lossy().into_owned())
}

#[tauri::command]
pub async fn git_show(root: String, path: String, rev: String) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let Some(rel) = rel_to_top(&root, &path) else { return None };
        let spec = if rev == "head" { format!("HEAD:{rel}") } else { format!(":{rel}") };
        let out = command(&root).args(["show", &spec]).output().ok()?;
        if !out.status.success() || out.stdout.iter().take(8000).any(|b| *b == 0) {
            return None;
        }
        String::from_utf8(out.stdout).ok()
    })
    .await
    .map_err(err)
}

fn with_paths<'a>(base: &[&'a str], paths: &'a [String]) -> Vec<&'a str> {
    let mut args: Vec<&str> = base.to_vec();
    args.push("--");
    args.extend(paths.iter().map(String::as_str));
    args
}

#[tauri::command]
pub async fn git_stage(root: String, paths: Vec<String>) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || git_checked(&root, &with_paths(&["add", "-A"], &paths)).map(|_| ()))
        .await
        .map_err(err)?
}

#[tauri::command]
pub async fn git_unstage(root: String, paths: Vec<String>) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        if git(&root, &["rev-parse", "--verify", "-q", "HEAD"]).is_some() {
            git_checked(&root, &with_paths(&["reset", "-q", "HEAD"], &paths)).map(|_| ())
        } else {
            git_checked(&root, &with_paths(&["rm", "--cached", "-r", "-q"], &paths)).map(|_| ())
        }
    })
    .await
    .map_err(err)?
}

#[tauri::command]
pub async fn git_discard(root: String, tracked: Vec<String>, untracked: Vec<String>) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        if !tracked.is_empty() {
            git_checked(&root, &with_paths(&["checkout", "-q"], &tracked))?;
        }
        for p in &untracked {
            trash::delete(p).map_err(err)?;
        }
        Ok(())
    })
    .await
    .map_err(err)?
}

#[tauri::command]
pub async fn git_commit(root: String, message: String, all: bool) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        if all {
            git_checked(&root, &["add", "-A"])?;
        }
        git_checked(&root, &["commit", "-q", "-m", &message]).map(|_| ())
    })
    .await
    .map_err(err)?
}

#[tauri::command]
pub async fn git_push(root: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let has_upstream = git(&root, &["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]).is_some();
        if has_upstream {
            git_checked(&root, &["push", "-q"]).map(|_| ())
        } else {
            git_checked(&root, &["push", "-q", "-u", "origin", "HEAD"]).map(|_| ())
        }
    })
    .await
    .map_err(err)?
}

#[tauri::command]
pub async fn git_pull(root: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || git_checked(&root, &["pull", "-q", "--no-edit"]).map(|_| ()))
        .await
        .map_err(err)?
}

#[tauri::command]
pub async fn git_fetch(root: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || git_checked(&root, &["fetch", "-q"]).map(|_| ()))
        .await
        .map_err(err)?
}
