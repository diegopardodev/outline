use crate::err;
use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::Mutex;
use tauri::ipc::Channel;
use tauri::State;

struct Pty {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    child: Box<dyn Child + Send + Sync>,
}

#[derive(Default)]
pub struct Ptys(Mutex<HashMap<u32, Pty>>);

#[derive(Serialize, Clone)]
#[serde(tag = "kind", content = "data")]
pub enum PtyEvent {
    Data(String),
    Exit,
}

#[tauri::command]
pub fn pty_spawn(
    state: State<Ptys>,
    id: u32,
    cwd: Option<String>,
    cols: u16,
    rows: u16,
    on_event: Channel<PtyEvent>,
) -> Result<(), String> {
    let pair = native_pty_system()
        .openpty(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
        .map_err(err)?;
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".into());
    let mut cmd = CommandBuilder::new(&shell);
    cmd.arg("-l");
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");
    cmd.env("TERM_PROGRAM", "Outline");
    if std::env::var("LANG").is_err() {
        cmd.env("LANG", "en_US.UTF-8");
    }
    let home = std::env::var("HOME").unwrap_or_else(|_| "/".into());
    cmd.cwd(cwd.unwrap_or(home));

    let child = pair.slave.spawn_command(cmd).map_err(err)?;
    drop(pair.slave);
    let mut reader = pair.master.try_clone_reader().map_err(err)?;
    let writer = pair.master.take_writer().map_err(err)?;

    std::thread::spawn(move || {
        let mut buf = [0u8; 16384];
        let mut pending: Vec<u8> = Vec::new();
        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    pending.extend_from_slice(&buf[..n]);
                    let valid = match std::str::from_utf8(&pending) {
                        Ok(_) => pending.len(),
                        Err(e) if e.error_len().is_some() => pending.len(),
                        Err(e) => e.valid_up_to(),
                    };
                    if valid == 0 {
                        continue;
                    }
                    let chunk: Vec<u8> = pending.drain(..valid).collect();
                    let text = String::from_utf8_lossy(&chunk).to_string();
                    if on_event.send(PtyEvent::Data(text)).is_err() {
                        break;
                    }
                }
            }
        }
        let _ = on_event.send(PtyEvent::Exit);
    });

    state.0.lock().map_err(err)?.insert(id, Pty { master: pair.master, writer, child });
    Ok(())
}

#[tauri::command]
pub fn pty_write(state: State<Ptys>, id: u32, data: String) -> Result<(), String> {
    let mut map = state.0.lock().map_err(err)?;
    let pty = map.get_mut(&id).ok_or("No such terminal")?;
    pty.writer.write_all(data.as_bytes()).map_err(err)?;
    pty.writer.flush().map_err(err)
}

#[tauri::command]
pub fn pty_resize(state: State<Ptys>, id: u32, cols: u16, rows: u16) -> Result<(), String> {
    let map = state.0.lock().map_err(err)?;
    let pty = map.get(&id).ok_or("No such terminal")?;
    pty.master
        .resize(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
        .map_err(err)
}

#[tauri::command]
pub fn pty_kill(state: State<Ptys>, id: u32) -> Result<(), String> {
    if let Some(mut pty) = state.0.lock().map_err(err)?.remove(&id) {
        let _ = pty.child.kill();
        // Reap the shell so it doesn't linger as a zombie process.
        std::thread::spawn(move || {
            let _ = pty.child.wait();
        });
    }
    Ok(())
}
