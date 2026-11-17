use crate::err;
use std::fs;
use std::path::PathBuf;

fn settings_file() -> PathBuf {
    let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".into());
    PathBuf::from(home).join(".outline/settings.json")
}

#[tauri::command]
pub fn settings_path() -> String {
    settings_file().to_string_lossy().into_owned()
}

#[tauri::command]
pub fn read_settings(template: String) -> Result<String, String> {
    let file = settings_file();
    if !file.exists() {
        if let Some(parent) = file.parent() {
            fs::create_dir_all(parent).map_err(err)?;
        }
        fs::write(&file, &template).map_err(err)?;
        return Ok(template);
    }
    fs::read_to_string(&file).map_err(err)
}
