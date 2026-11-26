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
    return JSON.parse(readFileSync(path, 'utf8'));
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

const cargo = readFileSync(join(tauriDir, 'src-tauri/Cargo.toml'), 'utf8');
check('Cargo.toml: пакет ikguide-studio', /name\s*=\s*"ikguide-studio"/.test(cargo));
check('Cargo.toml: Rust edition 2021', /edition\s*=\s*"2021"/.test(cargo));
check('Cargo.toml: tauri 2 + dialog + fs', /tauri\s*=\s*\{\s*version\s*=\s*"2"/.test(cargo) && /tauri-plugin-dialog\s*=\s*"2"/.test(cargo) && /tauri-plugin-fs\s*=\s*"2"/.test(cargo));
check('Cargo.toml: crate-type для Tauri 2', /crate-type\s*=\s*\[[^\]]*"cdylib"/.test(cargo));

const libRs = readFileSync(join(tauriDir, 'src-tauri/src/lib.rs'), 'utf8');
const mainRs = readFileSync(join(tauriDir, 'src-tauri/src/main.rs'), 'utf8');
check('lib.rs регистрирует плагины dialog и fs', libRs.includes('tauri_plugin_dialog::init()') && libRs.includes('tauri_plugin_fs::init()'));
check('lib.rs не печатает листы: PDF сохраняется файлом', !libRs.includes('printed') && !libRs.includes('window.print'));
check('lib.rs умеет тихо поднять движок из папки engine', /engine/.test(libRs) && /ikguide-vision\.exe/.test(libRs));
check('движок стартует без окна консоли', libRs.includes('CREATE_NO_WINDOW') && libRs.includes('creation_flags'));
check('движок поднимается в setup, а не по кнопке', libRs.includes('.setup(') && libRs.includes('spawn_local_engines'));
check('main.rs зовёт ikguide_studio_lib::run()', mainRs.includes('ikguide_studio_lib::run()'));
check('main.rs скрывает консоль в release', mainRs.includes('windows_subsystem'));

const capability = readJson(join(tauriDir, 'src-tauri/capabilities/default.json'));
check('capabilities: окно main', (capability.windows ?? []).includes('main'));
const permissions = (capability.permissions ?? []).map((entry) => (typeof entry === 'string' ? entry : entry.identifier));
check('capabilities: диалог «Сохранить как…»', permissions.includes('dialog:default') && permissions.includes('dialog:allow-save'));
check('capabilities: запись бинарного PDF', permissions.includes('fs:allow-write-file'));
check('capabilities: нативный проводник Windows', permissions.includes('dialog:allow-open'));
check('capabilities: чтение выбранного чертежа', permissions.includes('fs:allow-read-file'));

for (const [service, exe] of [
  ['vision-api', 'ikguide-vision'],
  ['cad-api', 'ikguide-cad'],
]) {
  const entry = join(ROOT, 'services', service, 'engine_entry.py');
  check(`services/${service}/engine_entry.py для PyInstaller`, existsSync(entry));
  if (existsSync(entry)) {
    const source = readFileSync(entry, 'utf8');
    check(`  ${service}: слушает только 127.0.0.1`, source.includes('127.0.0.1') && !source.includes('0.0.0.0'));
    check(`  ${service}: имя ${exe} упоминается в workflow`, readFileSync(join(ROOT, '.github/workflows/release-builds.yml'), 'utf8').includes(exe));
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
    workflow = parseYaml(readFileSync(path, 'utf8'));
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

const releaseYaml = readFileSync(join(workflowsDir, 'release-builds.yml'), 'utf8');
check('release: понятное имя workflow «Build Windows .exe»', /^name:\s*Build Windows \.exe\s*$/m.test(releaseYaml));
check('release: сборка .exe на windows-latest', releaseYaml.includes('windows-latest'));
check('release: Node 20', /NODE_VERSION:\s*'20'|node-version:\s*'20'/.test(releaseYaml));
check('release: rust-toolchain', releaseYaml.includes('dtolnay/rust-toolchain'));
check('release: нет Android/.apk', !/apk|android|capacitor|gradle/i.test(releaseYaml));
check('release: артефакт .exe', releaseYaml.includes('ikguide-studio-windows'));
check('release: переносимый .exe без установки', releaseYaml.includes('IKGuide-Studio-Portable.exe'));
check(
  'release: Windows-джобы обходят имя репозитория с точкой на конце',
  (releaseYaml.match(/git clone[^\n]*ikguide/g) ?? []).length >= 2,
);
check('release: причина падения Tauri видна в аннотации', releaseYaml.includes('::error title=Сборка Tauri упала'));
check('release: установщик IKGuide-Studio-Setup.exe', releaseYaml.includes('IKGuide-Studio-Setup.exe'));
check('release: движок PyInstaller отдельной джобой', /build-engine-windows/.test(releaseYaml) && releaseYaml.includes('pyinstaller'));
check(
  'release: падение PyInstaller не блокирует .exe',
  /build-engine-windows:[\s\S]{0,400}continue-on-error:\s*true/.test(releaseYaml),
);
check('release: архив локального бэкенда', releaseYaml.includes('ikguide-backend'));
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
  check('  .bat запускает оба uvicorn-сервиса', (bat.match(/uvicorn/g) ?? []).length >= 2);
  check('  .bat слушает только 127.0.0.1', bat.includes('127.0.0.1') && !bat.includes('--host 0.0.0.0'));
}
if (existsSync(shPath)) {
  const sh = readFileSync(shPath, 'utf8');
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
