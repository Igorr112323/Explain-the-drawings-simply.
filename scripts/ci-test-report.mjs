/**
 * Хвост vitest для аннотаций GitHub Actions.
 *
 * Логи Actions из некоторых сред не скачиваются, поэтому падение теста должно быть видно прямо
 * в сводке запуска: пишем `::error` на каждый упавший тест и на каждую необработанную ошибку.
 * Скрипт запускается только когда vitest уже упал, и всегда выходит с кодом 0 — иначе он затрёт
 * исходный статус шага.
 */
import { existsSync, readFileSync } from 'node:fs';

const reportPath = process.argv[2] ?? 'vitest.json';
const logPath = process.argv[3] ?? 'vitest.log';

/** Хвост вывода vitest: в нём бывает блок «Unhandled Errors», которого нет в JSON. */
function printLogTail(path) {
  if (!existsSync(path)) {
    return;
  }
  const clean = readFileSync(path, 'utf8').replace(/\u001b\[[\d;]*m/g, '');
  const marker = clean.indexOf('Unhandled Errors');
  const block = marker >= 0 ? clean.slice(marker, marker + 1500) : clean.slice(-1500);
  for (const line of block.split('\n').map((item) => item.trim()).filter(Boolean).slice(0, 25)) {
    console.log(`::error title=vitest::${line.replace(/%/g, '%25')}`);
  }
}

/** GitHub режет аннотации по строке — печатаем первые строки сообщения. */
function emit(title, message, limit = 6) {
  const lines = String(message ?? '')
    .replace(/\u001b\[[\d;]*m/g, '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, limit);
  if (lines.length === 0) {
    console.log(`::error title=${title}::нет текста ошибки`);
    return;
  }
  for (const line of lines) {
    console.log(`::error title=${title}::${line.replace(/%/g, '%25')}`);
  }
}

if (!existsSync(reportPath)) {
  emit('vitest', 'Отчёт vitest не создан: тесты не запустились вовсе.');
  printLogTail(logPath);
  process.exit(0);
}

let report;
try {
  report = JSON.parse(readFileSync(reportPath, 'utf8'));
} catch (error) {
  emit('vitest', `Отчёт vitest не читается: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(0);
}

for (const file of report.testResults ?? []) {
  if (file.status === 'failed' && (!file.assertionResults || file.assertionResults.length === 0)) {
    emit(`vitest: ${file.name ?? 'файл'}`, file.message);
  }
  for (const test of file.assertionResults ?? []) {
    if (test.status !== 'failed') {
      continue;
    }
    const name = (test.fullName ?? test.title ?? file.name ?? 'тест').replace(/\s+/g, ' ').slice(0, 120);
    emit(`vitest: ${name}`, (test.failureMessages ?? [])[0]);
  }
}

let reported = 0;
for (const file of report.testResults ?? []) {
  if (file.status === 'failed' && (!file.assertionResults || file.assertionResults.length === 0)) {
    reported += 1;
  }
  reported += (file.assertionResults ?? []).filter((test) => test.status === 'failed').length;
}
for (const error of report.unhandledErrors ?? []) {
  emit(`vitest: необработанная ошибка ${error.name ?? ''}`.trim(), `${error.message ?? ''}\n${error.stack ?? ''}`);
  reported += 1;
}

// Ни одного упавшего теста, но код возврата не ноль: печатаем блок ошибок из вывода.
if (reported === 0) {
  printLogTail(logPath);
}
