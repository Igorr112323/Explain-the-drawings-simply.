#!/usr/bin/env node
/**
 * Проверяет всё, что собирается только на GitHub Actions: Tauri-проект, Android-проект Capacitor,
 * workflow-файлы и цеховые скрипты.
 *
 * Здесь нет и не может быть `cargo check` / `gradle assembleDebug` — в песочнице разработки нет ни
 * Rust, ни JDK, ни Android SDK. Зато здесь ловятся опечатки в путях, битый JSON/YAML/XML, иконки не
 * того размера и разъехавшиеся идентификаторы приложения: именно они ломают релизную сборку.
 *
 *   node scripts/check-native-configs.mjs
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
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
  const signature = bytes.subarray(0, 8).toString('hex');
  if (signature !== '89504e470d0a1a0a') {
    return null;
  }
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

/** Минимальная проверка well-formed XML: парные теги в правильном порядке, без разбора атрибутов. */
function xmlProblems(source) {
  const problems = [];
  const withoutComments = source.replace(/<!--[\s\S]*?-->/g, '');
  const withoutDecl = withoutComments.replace(/<\?[\s\S]*?\?>/g, '');
  const stack = [];
  const tagPattern = /<\s*(\/?)\s*([A-Za-z_][\w.:-]*)([^>]*?)(\/?)\s*>/g;
  let match;
  let consumed = 0;
  while ((match = tagPattern.exec(withoutDecl)) !== null) {
    consumed += match[0].length;
    const [, closing, name, , selfClosing] = match;
    if (selfClosing === '/') {
      continue;
    }
    if (closing === '/') {
      const open = stack.pop();
      if (open !== name) {
        problems.push(`закрывающий </${name}> не совпадает с <${open ?? '—'}>`);
        return problems;
      }
    } else {
      stack.push(name);
    }
  }
  if (stack.length > 0) {
    problems.push(`не закрыты теги: ${stack.join(', ')}`);
  }
  if (consumed === 0) {
    problems.push('файл не содержит тегов');
  }
  return problems;
}

/* ------------------------------------------------------------------ Tauri */

section('Tauri (.exe)');
const tauriDir = join(ROOT, 'apps/desktop-tauri');
const tauriConfPath = join(tauriDir, 'src-tauri/tauri.conf.json');
check('apps/desktop-tauri/src-tauri/tauri.conf.json существует', existsSync(tauriConfPath));
const tauriConf = readJson(tauriConfPath);
check('productName задан', tauriConf.productName === 'IKGuide Studio', tauriConf.productName);
check('identifier = ru.ikguide.studio', tauriConf.identifier === 'ru.ikguide.studio', tauriConf.identifier);
check('окно 1360×860, минимум 960×640', (() => {
  const window = tauriConf.app?.windows?.[0] ?? {};
  return window.width === 1360 && window.height === 860 && window.minWidth === 960 && window.minHeight === 640;
})());
check('заголовок окна по-русски', (tauriConf.app?.windows?.[0]?.title ?? '').includes('ИК-Гайд'));

const frontendDist = tauriConf.build?.frontendDist ?? '';
const frontendResolved = resolve(tauriDir, 'src-tauri', frontendDist);
check(
  'frontendDist указывает на apps/studio-web/dist',
  frontendResolved === join(ROOT, 'apps/studio-web/dist'),
  frontendResolved,
);
if (existsSync(join(frontendResolved, 'index.html'))) {
  check('веб-бандл собран (index.html на месте)', true);
} else {
  // В CI до `npm run build` бандла нет — это нормально, Tauri собирает его сам.
  note('веб-бандл ещё не собран: Tauri соберёт его в beforeBuildCommand');
}
check(
  'beforeBuildCommand собирает пакеты и студию (нужен dist ядра)',
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
check('lib.rs отдаёт команду print_sheet', libRs.includes('fn print_sheet') && libRs.includes('generate_handler!'));
check('main.rs зовёт ikguide_studio_lib::run()', mainRs.includes('ikguide_studio_lib::run()'));
check('main.rs скрывает консоль в release', mainRs.includes('windows_subsystem'));

const capability = readJson(join(tauriDir, 'src-tauri/capabilities/default.json'));
check('capabilities: окно main', (capability.windows ?? []).includes('main'));
const permissions = (capability.permissions ?? []).map((entry) => (typeof entry === 'string' ? entry : entry.identifier));
check(
  'capabilities: dialog + fs',
  permissions.includes('dialog:default') && permissions.includes('fs:allow-read-text-file'),
);
check(
  'capabilities: чтение и запись текстовых файлов',
  permissions.includes('fs:allow-read-text-file') && permissions.includes('fs:allow-write-text-file'),
);

/* --------------------------------------------------------------- Capacitor */

section('Capacitor (.apk)');
const mobileDir = join(ROOT, 'apps/mobile-capacitor');
const capacitorConfig = readFileSync(join(mobileDir, 'capacitor.config.ts'), 'utf8');
check('appId = ru.ikguide.worker', capacitorConfig.includes("appId: 'ru.ikguide.worker'"));
check('appName = «ИК-Гайд Цех»', capacitorConfig.includes("appName: 'ИК-Гайд Цех'"));
check('webDir → apps/studio-web/dist', capacitorConfig.includes("webDir: '../../apps/studio-web/dist'"));
check('разрешён HTTP к цеховому серверу', /cleartext:\s*true/.test(capacitorConfig));

const androidDir = join(mobileDir, 'android');
for (const file of ['settings.gradle', 'build.gradle', 'variables.gradle', 'gradle.properties', 'gradlew', 'gradlew.bat', 'gradle/wrapper/gradle-wrapper.properties', 'gradle/wrapper/gradle-wrapper.jar']) {
  check(`android/${file}`, existsSync(join(androidDir, file)));
}
const appGradle = readFileSync(join(androidDir, 'app/build.gradle'), 'utf8');
check('applicationId совпадает с appId', appGradle.includes('applicationId "ru.ikguide.worker"'));
check('Java 17 в compileOptions', appGradle.includes('JavaVersion.VERSION_17'));
const wrapperProps = readFileSync(join(androidDir, 'gradle/wrapper/gradle-wrapper.properties'), 'utf8');
check('Gradle wrapper 8.x', /gradle-8\.\d/.test(wrapperProps), wrapperProps.split('\n').find((line) => line.startsWith('distributionUrl')));

const manifestPath = join(androidDir, 'app/src/main/AndroidManifest.xml');
const manifest = readFileSync(manifestPath, 'utf8');
const manifestProblems = xmlProblems(manifest);
check('AndroidManifest.xml — корректный XML', manifestProblems.length === 0, manifestProblems.join('; '));
for (const permission of ['INTERNET', 'CAMERA', 'ACCESS_NETWORK_STATE', 'READ_MEDIA_IMAGES', 'READ_EXTERNAL_STORAGE']) {
  check(`AndroidManifest: ${permission}`, manifest.includes(`android.permission.${permission}`));
}
check('AndroidManifest: network_security_config', manifest.includes('@xml/network_security_config'));
check('AndroidManifest: usesCleartextTraffic', manifest.includes('android:usesCleartextTraffic="true"'));

const networkConfigPath = join(androidDir, 'app/src/main/res/xml/network_security_config.xml');
check('res/xml/network_security_config.xml', existsSync(networkConfigPath));
if (existsSync(networkConfigPath)) {
  const problems = xmlProblems(readFileSync(networkConfigPath, 'utf8'));
  check('network_security_config.xml — корректный XML', problems.length === 0, problems.join('; '));
  check('network_security_config: cleartext для локальной сети', readFileSync(networkConfigPath, 'utf8').includes('cleartextTrafficPermitted="true"'));
}

for (const [folder, size] of Object.entries({
  'mipmap-mdpi': 48,
  'mipmap-hdpi': 72,
  'mipmap-xhdpi': 96,
  'mipmap-xxhdpi': 144,
  'mipmap-xxxhdpi': 192,
})) {
  for (const name of ['ic_launcher.png', 'ic_launcher_round.png', 'ic_launcher_foreground.png']) {
    const path = join(androidDir, 'app/src/main/res', folder, name);
    const exists = existsSync(path);
    check(`res/${folder}/${name}`, exists);
    if (exists) {
      const dimensions = pngSize(path);
      check(`  ${folder}/${name} — ${size}×${size}`, dimensions?.width === size && dimensions?.height === size, JSON.stringify(dimensions));
    }
  }
}

const stringsXml = readFileSync(join(androidDir, 'app/src/main/res/values/strings.xml'), 'utf8');
check('strings.xml: app_name «ИК-Гайд Цех»', stringsXml.includes('<string name="app_name">ИК-Гайд Цех</string>'));
const stylesXml = readFileSync(join(androidDir, 'app/src/main/res/values/styles.xml'), 'utf8');
check('styles.xml: тема запуска со сплэшем', stylesXml.includes('AppTheme.NoActionBarLaunch'));
const mainActivity = readFileSync(join(androidDir, 'app/src/main/java/ru/ikguide/worker/MainActivity.java'), 'utf8');
check('MainActivity в пакете ru.ikguide.worker', mainActivity.includes('package ru.ikguide.worker;'));
check('MainActivity наследует BridgeActivity (камера через Capacitor)', mainActivity.includes('extends BridgeActivity'));

/* --------------------------------------------------------------- Workflows */

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
check('release: сборка .exe на windows-latest', releaseYaml.includes('windows-latest'));
check('release: сборка .apk на ubuntu-latest', releaseYaml.includes('ubuntu-latest'));
check('release: Node 20', /NODE_VERSION:\s*'20'|node-version:\s*'20'/.test(releaseYaml));
check('release: rust-toolchain', releaseYaml.includes('dtolnay/rust-toolchain'));
check('release: Java 17 temurin', releaseYaml.includes('temurin') && releaseYaml.includes("'17'"));
check('release: setup-android', releaseYaml.includes('android-actions/setup-android'));
check('release: artifacts .exe / .apk', releaseYaml.includes('ikguide-studio-windows') && releaseYaml.includes('ikguide-worker-android'));
check('release: тэг v* + workflow_dispatch', releaseYaml.includes("tags:") && releaseYaml.includes('workflow_dispatch'));

/* ------------------------------------------------------------------ Скрипты */

section('Скрипты цеха');
const shPath = join(ROOT, 'scripts/start-workshop-servers.sh');
const batPath = join(ROOT, 'scripts/start-workshop-servers.bat');
check('scripts/start-workshop-servers.sh', existsSync(shPath));
check('scripts/start-workshop-servers.bat', existsSync(batPath));
if (existsSync(batPath)) {
  const bat = readFileSync(batPath, 'latin1');
  check('  .bat в формате CRLF (обязательно для cmd.exe)', bat.includes('\r\n'));
  check('  .bat запускает оба uvicorn-сервиса', (bat.match(/uvicorn/g) ?? []).length >= 2);
  check('  .bat печатает адрес для планшета', bat.includes('8001'));
}
if (existsSync(shPath)) {
  const sh = readFileSync(shPath, 'utf8');
  check('  .sh со shebang', sh.startsWith('#!/usr/bin/env bash'));
  check('  .sh знает про install/run', sh.includes('install') && sh.includes('run'));
}

/* --------------------------------------------------------------- Итог */

console.log(`\n${failures === 0 ? '✓' : '✗'} Проверок: ${checks}, провалов: ${failures}.`);
if (failures > 0) {
  console.error('\nКонфигурация нативной упаковки сломана — релизные сборки упадут.');
  process.exit(1);
}
console.log('Нативные конфиги согласованы (сборка .exe/.apk выполняется на GitHub Actions: здесь нет Rust/JDK/Android SDK).');
