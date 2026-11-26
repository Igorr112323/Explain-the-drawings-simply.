//! IKGuide Studio desktop shell.
//!
//! The whole UI is the same React bundle that runs in the browser (`apps/studio-web/dist`); Rust only
//! adds what a browser cannot do on a workstation:
//!   * native «Сохранить как…» for the finished PDF (`tauri-plugin-dialog`);
//!   * writing the chosen file to disk (`tauri-plugin-fs`);
//!   * quiet start of the local 2D recognition engine (`engine\ikguide-vision.exe`), its health
//!     check and clean shutdown together with the window.
//!
//! There is no printing dialog here: the app produces a real `.pdf` file, not a print job.

use std::io::{Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::path::{Path, PathBuf};
use std::process::Child;
use std::sync::{Mutex, Once};
use std::time::{Duration, Instant};

/// Порт, на котором движок распознавания слушает только localhost.
const ENGINE_PORT: u16 = 8000;

/// Запасной порт: если 8000 занят чужим процессом, движок мог подняться на 8001.
const ENGINE_FALLBACK_PORT: u16 = 8001;

/// Имена исполняемых файлов, которые может положить рядом установщик движка.
const ENGINE_BINARIES: [&str; 1] = ["ikguide-vision.exe"];

/// Сколько ждём, пока sidecar начнёт отвечать на `/health` после старта.
const HEALTH_TIMEOUT: Duration = Duration::from_secs(30);

const CONNECT_TIMEOUT: Duration = Duration::from_millis(400);
const IO_TIMEOUT: Duration = Duration::from_millis(900);
const POLL_INTERVAL: Duration = Duration::from_millis(300);

/// Дочерний процесс движка: пока он жив, приложение обязано его прибрать.
static ENGINE_CHILD: Mutex<Option<Child>> = Mutex::new(None);
static ENGINE_START: Once = Once::new();

/// Version of the desktop shell, shown in diagnostics.
#[tauri::command]
fn shell_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

/// Честный статус движка для интерфейса: отвечает ли он и запущен ли он самим приложением.
#[derive(serde::Serialize)]
struct EngineStatus {
    running: bool,
    port: u16,
    /// `true`, если движок подняло приложение (а не инженер вручную в консоли).
    managed: bool,
    hint: String,
}

#[tauri::command]
fn engine_status() -> EngineStatus {
    let managed = ENGINE_CHILD.lock().map(|guard| guard.is_some()).unwrap_or(false);
    let running = engine_port().is_some();
    let hint = if running {
        "Движок распознавания отвечает: фото, сканы и PDF читаются целиком.".to_string()
    } else if engine_available() {
        "Движок распознавания не отвечает: подождите пару секунд после запуска или перезапустите приложение."
            .to_string()
    } else {
        "Движок распознавания не установлен: векторные PDF распознаются, фото и сканы — нет."
            .to_string()
    };
    EngineStatus {
        running,
        port: engine_port().unwrap_or(ENGINE_PORT),
        managed,
        hint,
    }
}

/// Пишет запрос `/health` и говорит, ответил ли движок кодом 200.
fn health_ok(port: u16) -> bool {
    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    let mut stream = match TcpStream::connect_timeout(&addr, CONNECT_TIMEOUT) {
        Ok(stream) => stream,
        Err(_) => return false,
    };
    let _ = stream.set_read_timeout(Some(IO_TIMEOUT));
    let _ = stream.set_write_timeout(Some(IO_TIMEOUT));
    if stream
        .write_all(b"GET /health HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n")
        .is_err()
    {
        return false;
    }
    let mut buffer = [0u8; 128];
    match stream.read(&mut buffer) {
        Ok(read) if read > 0 => {
            let head = String::from_utf8_lossy(&buffer[..read]);
            head.starts_with("HTTP/1.") && head.contains(" 200")
        }
        _ => false,
    }
}

/// Порт живого движка, если он уже отвечает (8000, затем 8001).
fn engine_port() -> Option<u16> {
    if health_ok(ENGINE_PORT) {
        Some(ENGINE_PORT)
    } else if health_ok(ENGINE_FALLBACK_PORT) {
        Some(ENGINE_FALLBACK_PORT)
    } else {
        None
    }
}

/// Ждёт готовности движка, не блокируя интерфейс: вызов идёт из фонового потока.
fn wait_for_health(timeout: Duration) -> bool {
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        if engine_port().is_some() {
            return true;
        }
        std::thread::sleep(POLL_INTERVAL);
    }
    false
}

/// Где искать движок. В установщике он лежит ресурсами (`$INSTDIR\engine`), в переносимой
/// сборке — рядом с `.exe`; на всякий случай проверяем и `resources\engine`.
fn engine_roots() -> Vec<PathBuf> {
    let mut roots = Vec::new();
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            roots.push(dir.to_path_buf());
            roots.push(dir.join("engine"));
            roots.push(dir.join("resources").join("engine"));
        }
    }
    roots
}

/// Путь к установленному движку, если он есть рядом с приложением.
fn engine_available() -> bool {
    find_engine().is_some()
}

fn find_engine() -> Option<PathBuf> {
    for root in engine_roots() {
        for name in ENGINE_BINARIES {
            let path = root.join(name);
            if path.is_file() {
                return Some(path);
            }
        }
    }
    None
}

/// Запускает движок в фоне, без чёрного окна консоли, и запоминает процесс для остановки.
///
/// Возвращает `false`, если файла нет или он не запустился — это не ошибка: приложение
/// продолжает работать, а статус движка в интерфейсе честно скажет, чего не хватает.
#[cfg(windows)]
fn spawn_quietly(path: &Path) -> bool {
    use std::os::windows::process::CommandExt;
    // `CREATE_NO_WINDOW` — процесс без консольного окна.
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    match std::process::Command::new(path)
        .creation_flags(CREATE_NO_WINDOW)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
    {
        Ok(child) => remember_child(child),
        Err(_) => false,
    }
}

#[cfg(not(windows))]
fn spawn_quietly(path: &Path) -> bool {
    match std::process::Command::new(path)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
    {
        Ok(child) => remember_child(child),
        Err(_) => false,
    }
}

fn remember_child(child: Child) -> bool {
    match ENGINE_CHILD.lock() {
        Ok(mut guard) => {
            *guard = Some(child);
            true
        }
        Err(_) => false,
    }
}

/// Поднимает движок один раз за процесс. Если сервер уже запущен вручную — не мешаем ему.
fn start_engine() {
    ENGINE_START.call_once(|| {
        std::thread::spawn(|| {
            if engine_port().is_some() {
                return;
            }
            let Some(path) = find_engine() else {
                return;
            };
            if spawn_quietly(&path) {
                // Ожидание порта не блокирует окно: интерфейс открывается сразу.
                let _ = wait_for_health(HEALTH_TIMEOUT);
            }
        });
    });
}

/// Останавливает движок вместе с его дочерними процессами (PyInstaller onefile создаёт их).
#[cfg(windows)]
fn stop_engine() {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;

    let child = match ENGINE_CHILD.lock() {
        Ok(mut guard) => guard.take(),
        Err(_) => None,
    };
    if let Some(mut child) = child {
        let pid = child.id().to_string();
        let _ = std::process::Command::new("taskkill")
            .args(["/PID", pid.as_str(), "/T", "/F"])
            .creation_flags(CREATE_NO_WINDOW)
            .status();
        let _ = child.wait();
    }
}

#[cfg(not(windows))]
fn stop_engine() {
    let child = match ENGINE_CHILD.lock() {
        Ok(mut guard) => guard.take(),
        Err(_) => None,
    };
    if let Some(mut child) = child {
        let _ = child.kill();
        let _ = child.wait();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![shell_version, engine_status])
        .setup(|_app| {
            start_engine();
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("не удалось собрать IKGuide Studio");

    app.run(|_app_handle, event| {
        if let tauri::RunEvent::Exit = event {
            // Окно закрыли — движок не должен остаться висеть в диспетчере задач.
            stop_engine();
        }
    });
}
