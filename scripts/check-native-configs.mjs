#!/usr/bin/env node
/**
 * Проверяет всё, что собирается только в релизе: Tauri-проект для `.exe`, workflow-файлы и
 * скрипты локального бэкенда.
 *
 * Здесь нет и не может быть `cargo check` — в песочнице разработки нет Rust. Зато здесь ловятся
 * опечатки в путях, битый JSON/YAML, иконки не того размера и разъехавшиеся идентификаторы
 * приложения: именно они ломают релизную сборку.
 *
 *   node scripts/check-native-configs.mjs
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

/** Читает текст с LF: Windows-checkout может переписать файл в CRLF, а проверки сравнивают строки. */
function readText(path) {
  return readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
}

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

let failures = 0;
let checks = 0;

function check(label, condition, detail = '') {
  checks += 1;
  if (condition) {
    console.log(`  ✓ ${label}`);
    return true;
  }
  failures += 1;
  console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
  return false;
}

function note(label) {
  console.log(`  · ${label}`);
}

function section(title) {
  console.log(`\n${title}`);
}

function readJson(path) {
  try {
    return JSON.parse(readText(path));
  } catch (error) {
    throw new Error(`${relative(ROOT, path)}: ${error.message}`);
  }
}

function pngSize(path) {
  const bytes = readFileSync(path);
  if (bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') {
    return null;
  }
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

/* ------------------------------------------------------------------ Tauri */

section('Tauri (.exe)');
const tauriDir = join(ROOT, 'apps/desktop-tauri');
const tauriConfPath = join(tauriDir, 'src-tauri/tauri.conf.json');
check('apps/desktop-tauri/src-tauri/tauri.conf.json существует', existsSync(tauriConfPath));
const tauriConf = readJson(tauriConfPath);
check('productName задан', tauriConf.productName === 'IKGuide Studio', tauriConf.productName);
check('identifier = ru.ikguide.studio', tauriConf.identifier === 'ru.ikguide.studio', tauriConf.identifier);

const window = tauriConf.app?.windows?.[0] ?? {};
check(
  'окно 1320×840, минимум 960×640',
  window.width === 1320 && window.height === 840 && window.minWidth === 960 && window.minHeight === 640,
  `${window.width}×${window.height}`,
);
check('заголовок окна «IKGuide Studio»', window.title === 'IKGuide Studio', window.title);
check(
  'светлый фон окна с первого кадра (нет чёрной вспышки)',
  /^#FBFBFD$/i.test(String(window.backgroundColor ?? '')),
  window.backgroundColor,
);
check('тема окна светлая', window.theme === 'Light', window.theme);
check('drag & drop файлов на окно включён', window.dragDropEnabled !== false);
check('в конфиге нет упоминаний QR и мобильного приложения', !/QR|qr-код|apk/i.test(JSON.stringify(tauriConf)));

const resources = JSON.stringify(tauriConf.bundle?.resources ?? []);
check('установщик вшивает движок ресурсами (engine/*)', resources.includes('engine/*'), resources);
check(
  'в src-tauri/engine есть заглушка — glob ресурсов не пустой',
  existsSync(join(tauriDir, 'src-tauri/engine/ПРОЧТИ-МЕНЯ.txt')),
);

const frontendDist = tauriConf.build?.frontendDist ?? '';
const frontendResolved = resolve(tauriDir, 'src-tauri', frontendDist);
check('frontendDist указывает на apps/studio-web/dist', frontendResolved === join(ROOT, 'apps/studio-web/dist'), frontendResolved);
if (existsSync(join(frontendResolved, 'index.html'))) {
  check('веб-бандл собран (index.html на месте)', true);
} else {
  note('веб-бандл ещё не собран: Tauri соберёт его в beforeBuildCommand');
}
check(
  'beforeBuildCommand собирает пакеты и студию',
  String(tauriConf.build?.beforeBuildCommand ?? '').includes('npm run build'),
  tauriConf.build?.beforeBuildCommand,
);
check(
  'beforeDevCommand собирает пакеты и запускает dev-сервер',
  String(tauriConf.build?.beforeDevCommand ?? '').includes('build:packages') &&
    String(tauriConf.build?.beforeDevCommand ?? '').includes('run dev'),
  tauriConf.build?.beforeDevCommand,
);

for (const icon of tauriConf.bundle?.icon ?? []) {
  const path = join(tauriDir, 'src-tauri', icon);
  const exists = existsSync(path);
  check(`иконка ${icon} на месте`, exists);
  if (exists && icon.endsWith('.png')) {
    const size = pngSize(path);
    check(`  ${icon} — настоящий PNG ${size?.width}×${size?.height}`, Boolean(size && size.width === size.height && size.width >= 32));
  }
  if (exists && icon.endsWith('.ico')) {
    const bytes = readFileSync(path);
    check('  icon.ico имеет ICO-заголовок', bytes.readUInt16LE(0) === 0 && bytes.readUInt16LE(2) === 1);
  }
  if (exists && icon.endsWith('.icns')) {
    check('  icon.icns имеет ICNS-заголовок', readFileSync(path).subarray(0, 4).toString('ascii') === 'icns');
  }
}

/* ------------------------------------------------- Установщик NSIS (минимализм) */

section('Установщик NSIS');

const nsis = tauriConf.bundle?.windows?.nsis ?? {};
const nsisDir = join(tauriDir, 'src-tauri/nsis');
check('bundle.targets — только nsis (MSI не собираем)', JSON.stringify(tauriConf.bundle?.targets) === JSON.stringify(['nsis']), JSON.stringify(tauriConf.bundle?.targets));
check('nsis.installMode = currentUser', nsis.installMode === 'currentUser', nsis.installMode);
check('nsis.languages = ["Russian"]', JSON.stringify(nsis.languages) === JSON.stringify(['Russian']), JSON.stringify(nsis.languages));
check('nsis.displayLanguageSelector = false', nsis.displayLanguageSelector === false, nsis.displayLanguageSelector);
check('nsis.template указывает на nsis/installer.nsi', nsis.template === 'nsis/installer.nsi', nsis.template);
check('nsis.headerImage = nsis/nsis-header.bmp', nsis.headerImage === 'nsis/nsis-header.bmp', nsis.headerImage);
check('nsis.sidebarImage = nsis/nsis-sidebar.bmp', nsis.sidebarImage === 'nsis/nsis-sidebar.bmp', nsis.sidebarImage);
check('иконка установщика не переопределена (остаётся иконка приложения)', nsis.installerIcon === undefined, nsis.installerIcon);

/** Ширина, высота и битность BMP из заголовка файла — NSIS принимает только 24-bit. */
function bmpInfo(path) {
  if (!existsSync(path)) {
    return null;
  }
  const bytes = readFileSync(path);
  if (bytes.length < 54 || bytes.subarray(0, 2).toString('ascii') !== 'BM') {
    return null;
  }
  return {
    width: bytes.readInt32LE(18),
    height: bytes.readInt32LE(22),
    bits: bytes.readUInt16LE(28),
    compression: bytes.readUInt32LE(30),
  };
}

const sidebar = bmpInfo(join(nsisDir, 'nsis-sidebar.bmp'));
check('nsis-sidebar.bmp существует', Boolean(sidebar));
check('nsis-sidebar.bmp — 164×314, 24-bit, без сжатия', Boolean(sidebar && sidebar.width === 164 && sidebar.height === 314 && sidebar.bits === 24 && sidebar.compression === 0), JSON.stringify(sidebar));
const header = bmpInfo(join(nsisDir, 'nsis-header.bmp'));
check('nsis-header.bmp существует', Boolean(header));
check('nsis-header.bmp — 150×57, 24-bit, без сжатия', Boolean(header && header.width === 150 && header.height === 57 && header.bits === 24 && header.compression === 0), JSON.stringify(header));

const templatePath = join(nsisDir, 'installer.nsi');
const templateExists = existsSync(templatePath);
check('nsis/installer.nsi существует', templateExists);
if (templateExists) {
  const nsi = readText(templatePath);
  check('  шаблон подключает MUI2', nsi.includes('!include MUI2.nsh'));
  check('  шаблон включает XPStyle и DPI-awareness', nsi.includes('XPStyle on') && nsi.includes('ManifestDPIAware true'));
  check('  плоский белый фон (MUI_BGCOLOR) и чернильный текст', nsi.includes('!define MUI_BGCOLOR "FFFFFF"') && nsi.includes('!define MUI_TEXTCOLOR "1C1C1E"'));
  check('  прозрачный фон текста шапки', nsi.includes('!define MUI_HEADER_TRANSPARENT_TEXT'));
  check('  SetCtlColors для страниц Welcome/Directory/InstFiles/Finish', ['FlatWelcome', 'FlatDirectory', 'FlatInstFiles', 'FlatFinish'].every((fn) => nsi.includes(`Function ${fn}`)) && (nsi.match(/SetCtlColors/g) ?? []).length >= 6);
  check('  русские заголовки страниц', nsi.includes('Установка IKGuide Studio') && nsi.includes('IKGuide Studio установлен'));
  check(
    '  поток мастера: приветствие → папка → установка → готово',
    ['MUI_PAGE_WELCOME', 'MUI_PAGE_DIRECTORY', 'MUI_PAGE_INSTFILES', 'MUI_PAGE_FINISH'].every((page) => nsi.includes(`!insertmacro ${page}`)),
  );
  check('  страница «уже установлено» пропускается', /Function PageReinstall[^]*?Abort/.test(nsi.slice(nsi.indexOf('Function PageReinstall'), nsi.indexOf('Function PageReinstall') + 400)));
  check('  страница выбора папки «Пуск» скрыта', /MUI_PAGE_STARTMENU Application \$AppStartMenuFolder/.test(nsi) && nsi.includes('!define MUI_PAGE_CUSTOMFUNCTION_PRE Skip\n!insertmacro MUI_PAGE_STARTMENU'));
  // Встроенные проверки Tauri сохранены — иначе установщик потеряет WebView2 и удаление.
  check('  сохранена проверка и установка WebView2', nsi.includes('!define WEBVIEW2APPGUID') && nsi.includes('Section WebView2'));
  check('  сохранены ярлыки и удаление', nsi.includes('CreateOrUpdateStartMenuShortcut') && /Section Uninstall/.test(nsi));
  check('  сохранена проверка запущенного приложения', nsi.includes('CheckIfAppIsRunning'));
  // bundler компилирует .nsi как Handlebars: любой комментарий с {{...}} ломает сборку установщика.
  check(
    '  все {{...}} — валидные плейсхолдеры Handlebars',
    !/\{\{(?!\s*[#/!^@A-Za-z_])/.test(nsi) && (nsi.match(/\{\{/g) ?? []).length === (nsi.match(/\}\}/g) ?? []).length,
  );
  check('  сохранены переменные шаблонизатора Tauri', ['{{product_name}}', '{{version}}', '{{installer_icon}}', '{{sidebar_image}}', '{{header_image}}', '{{install_mode}}'].every((token) => nsi.includes(token)));
  check('  движок устанавливается вместе с приложением (resources)', !nsi.includes('cad-api'));
  // Структурный баланс блоков: самый частый способ сломать .nsi — незакрытый блок,
  // который makensis обнаружит только в Windows-сборке.
  const count = (pattern) => (nsi.match(pattern) ?? []).length;
  const balanced = [
    [count(/^Function\s/gm), count(/^FunctionEnd\b/gm), 'Function/FunctionEnd'],
    [count(/^Section\s/gm), count(/^SectionEnd\b/gm), 'Section/SectionEnd'],
    [count(/^!if/gm), count(/^!endif/gm), '!if/!endif'],
    [count(/\$\{If\}|\$\{IfNot\}/g), count(/\$\{EndIf\}/g), '${If}/${EndIf}'],
  ];
  for (const [open, close, label] of balanced) {
    check(`  блоки ${label} сбалансированы (${open}/${close})`, open === close);
  }
}

const cargo = readText(join(tauriDir, 'src-tauri/Cargo.toml'));
check('Cargo.toml: пакет ikguide-studio', /name\s*=\s*"ikguide-studio"/.test(cargo));
check('Cargo.toml: Rust edition 2021', /edition\s*=\s*"2021"/.test(cargo));
check('Cargo.toml: tauri 2 + dialog + fs', /tauri\s*=\s*\{\s*version\s*=\s*"2"/.test(cargo) && /tauri-plugin-dialog\s*=\s*"2"/.test(cargo) && /tauri-plugin-fs\s*=\s*"2"/.test(cargo));
check('Cargo.toml: crate-type для Tauri 2', /crate-type\s*=\s*\[[^\]]*"cdylib"/.test(cargo));

const libRs = readText(join(tauriDir, 'src-tauri/src/lib.rs'));
const mainRs = readText(join(tauriDir, 'src-tauri/src/main.rs'));
check('lib.rs регистрирует плагины dialog и fs', libRs.includes('tauri_plugin_dialog::init()') && libRs.includes('tauri_plugin_fs::init()'));
check('lib.rs не печатает листы: PDF сохраняется файлом', !libRs.includes('printed') && !libRs.includes('window.print'));
check('lib.rs умеет тихо поднять движок из папки engine', /engine/.test(libRs) && /ikguide-vision\.exe/.test(libRs));
check('движок стартует без окна консоли', libRs.includes('CREATE_NO_WINDOW') && libRs.includes('creation_flags'));
check('движок поднимается в setup, а не по кнопке', libRs.includes('.setup(') && libRs.includes('start_engine'));

// --- sidecar: пинг, ожидание порта и прибранный процесс ---------------------------------
check('sidecar: пинг /health по 127.0.0.1', libRs.includes('GET /health HTTP/1.1') && libRs.includes('127, 0, 0, 1'));
check('sidecar: ждём готовности порта, а не спим фиксированно', /fn wait_for_health\(/.test(libRs) && libRs.includes('HEALTH_TIMEOUT'));
check('sidecar: занятый порт 8000 не мешает (запасной 8001)', libRs.includes('ENGINE_FALLBACK_PORT: u16 = 8001'));
check('sidecar: если движок уже запущен, второй не поднимаем', /fn start_engine[^]*?engine_port\(\)\.is_some\(\)[^]*?return;/.test(libRs));
check('sidecar: процесс запоминается для остановки', libRs.includes('static ENGINE_CHILD') && libRs.includes('fn remember_child'));
check('sidecar: закрытие окна убивает всё дерево процессов', libRs.includes('RunEvent::Exit') && libRs.includes('stop_engine()') && libRs.includes('taskkill') && libRs.includes('"/T"'));
check('sidecar: отсутствие движка — не падение, а честный статус', libRs.includes('fn engine_available') && libRs.toLowerCase().includes('движок распознавания не установлен'));
check('sidecar: статус движка доступен интерфейсу', libRs.includes('#[tauri::command]') && libRs.includes('fn engine_status') && libRs.includes('generate_handler![shell_version, engine_status]'));
check('sidecar: stdout/stderr движка не наследуются (нет мусора в консоли)', (libRs.match(/Stdio::null\(\)/g) ?? []).length >= 6);
check('main.rs зовёт ikguide_studio_lib::run()', mainRs.includes('ikguide_studio_lib::run()'));
check('main.rs скрывает консоль в release', mainRs.includes('windows_subsystem'));

const capability = readJson(join(tauriDir, 'src-tauri/capabilities/default.json'));
check('capabilities: окно main', (capability.windows ?? []).includes('main'));
const permissions = (capability.permissions ?? []).map((entry) => (typeof entry === 'string' ? entry : entry.identifier));
check('capabilities: диалог «Сохранить как…»', permissions.includes('dialog:default') && permissions.includes('dialog:allow-save'));
check('capabilities: запись бинарного PDF', permissions.includes('fs:allow-write-file'));
check('capabilities: нативный проводник Windows', permissions.includes('dialog:allow-open'));
check('capabilities: чтение выбранного чертежа', permissions.includes('fs:allow-read-file'));

for (const [service, exe] of [['vision-api', 'ikguide-vision']]) {
  const entry = join(ROOT, 'services', service, 'engine_entry.py');
  check(`services/${service}/engine_entry.py для PyInstaller`, existsSync(entry));
  if (existsSync(entry)) {
    const source = readText(entry);
    check(`  ${service}: слушает только 127.0.0.1`, source.includes('127.0.0.1') && !source.includes('0.0.0.0'));
    check(`  ${service}: имя ${exe} упоминается в workflow`, readText(join(ROOT, '.github/workflows/release-builds.yml')).includes(exe));
  }
}

/* ------------------------------------------------------------------ Workflows */

section('GitHub Actions');
const workflowsDir = join(ROOT, '.github/workflows');
for (const file of ['ci.yml', 'release-builds.yml']) {
  const path = join(workflowsDir, file);
  const exists = existsSync(path);
  check(`.github/workflows/${file}`, exists);
  if (!exists) {
    continue;
  }
  let workflow;
  try {
    workflow = parseYaml(readText(path));
  } catch (error) {
    check(`  ${file}: YAML парсится`, false, error.message);
    continue;
  }
  check(`  ${file}: YAML парсится`, true);
  check(`  ${file}: объявлены jobs`, Boolean(workflow && workflow.jobs && Object.keys(workflow.jobs).length > 0));
  for (const [name, job] of Object.entries(workflow.jobs ?? {})) {
    check(`  ${file}: job ${name} имеет runs-on`, Boolean(job['runs-on'] ?? job['uses']));
    check(`  ${file}: job ${name} имеет шаги`, Array.isArray(job.steps) ? job.steps.length > 0 : Boolean(job.uses));
  }
}

const releaseYaml = readText(join(workflowsDir, 'release-builds.yml'));
check('release: понятное имя workflow «Build Windows .exe»', /^name:\s*Build Windows \.exe\s*$/m.test(releaseYaml));
check('release: сборка .exe на windows-latest', releaseYaml.includes('windows-latest'));
check('release: Node 20', /NODE_VERSION:\s*'20'|node-version:\s*'20'/.test(releaseYaml));
check('release: rust-toolchain', releaseYaml.includes('dtolnay/rust-toolchain'));
check('release: нет Android/.apk', !/apk|android|capacitor|gradle/i.test(releaseYaml));
check('release: артефакт .exe', releaseYaml.includes('ikguide-studio-windows'));
check('release: лёгкий portable без движка (только артефакты)', releaseYaml.includes('IKGuide-Studio-Portable-lite.exe'));
check('release: MSI не собираем (WiX падает на кириллице)', !releaseYaml.includes('nsis,msi'));
check(
  'release: Windows-джобы обходят имя репозитория с точкой на конце',
  (releaseYaml.match(/git clone[^\n]*ikguide/g) ?? []).length >= 2,
);
check('release: причина падения Tauri видна в аннотации', releaseYaml.includes('::error title=Сборка Tauri упала'));
check('release: движок упакован в архив для артефактов', releaseYaml.includes('ikguide-engine.zip'));
check(
  'release: .exe собирается после движка (движок вшивается в установщик)',
  /build-windows-exe:[\s\S]{0,300}needs:\s*\[checks, build-engine-windows\]/.test(releaseYaml),
);
check(
  'release: движок скачивается в src-tauri\\engine перед сборкой',
  releaseYaml.includes('actions/download-artifact@v4') && /src-tauri\\engine/.test(releaseYaml),
);
check(
  'release: в релиз уходит ровно один файл — установщик',
  /files:\s*C:\\ikguide\\artifacts\\IKGuide-Studio-Setup\.exe/.test(releaseYaml),
);
check('release: установщик IKGuide-Studio-Setup.exe', releaseYaml.includes('IKGuide-Studio-Setup.exe'));
check('release: движок PyInstaller отдельной джобой', /build-engine-windows/.test(releaseYaml) && releaseYaml.includes('pyinstaller'));
check(
  'release: падение PyInstaller не блокирует .exe',
  /build-engine-windows:[\s\S]{0,400}continue-on-error:\s*true/.test(releaseYaml),
);
check('release: архив локального бэкенда', releaseYaml.includes('ikguide-backend'));
check('release: бэкенд не прикрепляется к релизу (один файл)', !/files:\s*ikguide-backend\.zip/.test(releaseYaml));
check('release: тэг v* + workflow_dispatch', releaseYaml.includes('tags:') && releaseYaml.includes('workflow_dispatch'));

/* ------------------------------------------------------------------ Удалённое */

section('Что удалено из продукта');
check('нет apps/mobile-capacitor', !existsSync(join(ROOT, 'apps/mobile-capacitor')));
check('нет scripts/start-workshop-servers.*', !existsSync(join(ROOT, 'scripts/start-workshop-servers.sh')) && !existsSync(join(ROOT, 'scripts/start-workshop-servers.bat')));
const studioPkg = readJson(join(ROOT, 'apps/studio-web/package.json'));
const allDeps = { ...studioPkg.dependencies, ...studioPkg.devDependencies };
for (const legacy of ['qrcode', 'jsqr', 'fflate', '@types/qrcode']) {
  check(`в студии нет зависимости ${legacy}`, !(legacy in allDeps));
}
const rootPkg = readJson(join(ROOT, 'package.json'));
check('в корне нет скриптов mobile:*', !Object.keys(rootPkg.scripts ?? {}).some((name) => name.startsWith('mobile:')));

/* ------------------------------------------------------------------ Скрипты */

section('Локальный бэкенд');
const shPath = join(ROOT, 'scripts/start-backend.sh');
const batPath = join(ROOT, 'scripts/start-backend.bat');
check('scripts/start-backend.sh', existsSync(shPath));
check('scripts/start-backend.bat', existsSync(batPath));
check('npm run backend указывает на скрипт', String(rootPkg.scripts?.backend ?? '').includes('start-backend.sh'), rootPkg.scripts?.backend);
if (existsSync(batPath)) {
  const bat = readFileSync(batPath, 'latin1');
  check('  .bat в формате CRLF (обязательно для cmd.exe)', bat.includes('\r\n'));
  check('  .bat запускает uvicorn-сервис распознавания', (bat.match(/uvicorn/g) ?? []).length >= 1 && !bat.includes('cad-api'));
  check('  .bat слушает только 127.0.0.1', bat.includes('127.0.0.1') && !bat.includes('--host 0.0.0.0'));
}
if (existsSync(shPath)) {
  const sh = readText(shPath);
  check('  .sh со shebang', sh.startsWith('#!/usr/bin/env bash'));
  check('  .sh знает про install/run', sh.includes('install') && sh.includes('run'));
  check('  .sh не открывает порты наружу', !sh.includes('--host 0.0.0.0'));
}

/* --------------------------------------------------------------- Итог */

console.log(`\n${failures === 0 ? '✓' : '✗'} Проверок: ${checks}, провалов: ${failures}.`);
if (failures > 0) {
  console.error('\nКонфигурация релизной сборки сломана — сборка .exe упадёт.');
  process.exit(1);
}
console.log('Конфиги согласованы (сборка .exe выполняется на GitHub Actions: здесь нет Rust).');
