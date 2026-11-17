use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

const MAX_LOG_BYTES: u64 = 2 * 1024 * 1024;

static LOCK: Mutex<()> = Mutex::new(());

pub fn log_dir() -> PathBuf {
    let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".into());
    PathBuf::from(home).join("Library/Logs/Outline")
}

pub fn log_file() -> PathBuf {
    log_dir().join("outline.log")
}

fn timestamp() -> String {
    let now = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default();
    let secs = now.as_secs() as i64;
    let days = secs.div_euclid(86_400);
    let rem = secs.rem_euclid(86_400);
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = yoe + era * 400 + if month <= 2 { 1 } else { 0 };
    format!(
        "{year:04}-{month:02}-{day:02} {:02}:{:02}:{:02}.{:03}Z",
        rem / 3600,
        (rem % 3600) / 60,
        rem % 60,
        now.subsec_millis()
    )
}

pub fn append(level: &str, msg: &str) {
    let _guard = LOCK.lock();
    let dir = log_dir();
    if fs::create_dir_all(&dir).is_err() {
        return;
    }
    let file = log_file();
    if fs::metadata(&file).map(|m| m.len() > MAX_LOG_BYTES).unwrap_or(false) {
        let _ = fs::rename(&file, dir.join("outline.old.log"));
    }
    if let Ok(mut f) = OpenOptions::new().create(true).append(true).open(&file) {
        let _ = writeln!(f, "{} [{}] {}", timestamp(), level, msg);
    }
}

pub fn install_panic_hook() {
    let previous = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        append("panic", &info.to_string());
        previous(info);
    }));
}

#[tauri::command]
pub fn log_line(level: String, msg: String) {
    if cfg!(debug_assertions) {
        eprintln!("[webview] {} {}", level, msg);
    }
    append(&level, &msg);
}

#[tauri::command]
pub fn log_path() -> String {
    let file = log_file();
    if !file.exists() {
        append("info", "log created");
    }
    file.to_string_lossy().into_owned()
}
