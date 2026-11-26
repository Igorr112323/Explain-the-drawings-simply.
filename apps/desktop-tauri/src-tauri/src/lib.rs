//! IKGuide Studio desktop shell.
//!
//! The whole UI is the same React bundle that runs in the browser (`apps/studio-web/dist`); Rust only
//! adds what a browser cannot do on a workstation:
//!   * native «Сохранить как…» for the finished PDF (`tauri-plugin-dialog`);
//!   * writing the chosen file to disk (`tauri-plugin-fs`);
//!   * quiet start of the local Python engine, if it lies next to the `.exe` in `engine\`.
//!
//! There is no printing dialog here: the app produces a real `.pdf` file, not a print job.

use std::path::{Path, PathBuf};
use std::sync::Once;

/// Version of the desktop shell, shown in diagnostics.
#[tauri::command]
fn shell_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

/// Молчаливый запуск локального движка. Один раз за процесс: повторный вызов ничего не делает.
static ENGINE_ONCE: Once = Once::new();

/// Имена исполняемых файлов, которые может положить рядом установщик движка.
const ENGINE_BINARIES: [&str; 2] = ["ikguide-vision.exe", "ikguide-cad.exe"];

/// Где искать движок: `engine\` рядом с `.exe` и сам каталог `.exe` (portable-сборка).
fn engine_roots() -> Vec<PathBuf> {
    let mut roots = Vec::new();
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            roots.push(dir.join("engine"));
            roots.push(dir.to_path_buf());
        }
    }
    roots
}

/// Запускает движок в фоне, без чёрного окна консоли. Отсутствие файлов — не ошибка: приложение
/// одинаково хорошо работает и с уже запущенным сервером на 127.0.0.1:8000/8001.
fn spawn_local_engines() {
    ENGINE_ONCE.call_once(|| {
        for root in engine_roots() {
            for name in ENGINE_BINARIES {
                let path = root.join(name);
                if path.is_file() {
                    spawn_quietly(&path);
                }
            }
        }
    });
}

#[cfg(windows)]
fn spawn_quietly(path: &Path) {
    use std::os::windows::process::CommandExt;
    /// `CREATE_NO_WINDOW` — процесс без консольного окна.
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    let _ = std::process::Command::new(path)
        .creation_flags(CREATE_NO_WINDOW)
        .spawn();
}

#[cfg(not(windows))]
fn spawn_quietly(path: &Path) {
    let _ = std::process::Command::new(path).spawn();
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![shell_version])
        .setup(|_app| {
            spawn_local_engines();
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("не удалось запустить IKGuide Studio");
}
