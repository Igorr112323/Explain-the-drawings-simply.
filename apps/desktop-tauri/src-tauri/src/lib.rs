//! IkGuide Studio desktop shell.
//!
//! The whole UI is the same React bundle that runs in the browser (`apps/studio-web/dist`); Rust only
//! adds what a browser cannot do on a workshop PC:
//!   * native «Открыть файл» / «Сохранить как…» dialogs (`tauri-plugin-dialog`);
//!   * writing `.ikguide.json` / `.html` next to the drawing (`tauri-plugin-fs`);
//!   * printing the A4 sheet through the system dialog (`print_sheet`).

use tauri::WebviewWindow;

/// Opens the system print dialog for the current window (the print sheet lives in the DOM).
#[tauri::command]
fn print_sheet(window: WebviewWindow) -> Result<(), String> {
    window.eval("window.print()").map_err(|error| error.to_string())
}

/// Version of the desktop shell, shown in «Настройки и подключение».
#[tauri::command]
fn shell_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![print_sheet, shell_version])
        .run(tauri::generate_context!())
        .expect("не удалось запустить ИК-Гайд Инженер");
}
