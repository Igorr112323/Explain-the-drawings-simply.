//! IkGuide Studio desktop shell.
//!
//! The whole UI is the same React bundle that runs in the browser (`apps/studio-web/dist`); Rust only
//! adds what a browser cannot do on a workstation:
//!   * native «Сохранить как…» for the finished PDF (`tauri-plugin-dialog`);
//!   * writing the chosen file to disk (`tauri-plugin-fs`).
//!
//! There is no printing dialog here: the app produces a real `.pdf` file, not a print job.

/// Version of the desktop shell, shown in the footer and in diagnostics.
#[tauri::command]
fn shell_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![shell_version])
        .run(tauri::generate_context!())
        .expect("не удалось запустить IkGuide");
}
