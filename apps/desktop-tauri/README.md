# IkGuide для Windows (.exe)

Tauri v2 оборачивает готовый веб-бандл `apps/studio-web/dist` и добавляет то, чего нет в браузере:
системные диалоги и тихий запуск локального движка.

* окно `IKGuide Studio` — 1320×840, светлый фон `#FBFBFD` с первого кадра (никакой чёрной вспышки),
  тот же белый холст с парящими капсулами;
* кнопка `↑` («Сохранить PDF») открывает системный диалог «Сохранить как…»
  (`<Деталь>_инструкция.pdf`) и пишет файл в выбранное место
  (`@tauri-apps/plugin-dialog` + `plugin-fs`, разрешения — `fs:allow-write-file` для домашней папки,
  рабочего стола, документов, загрузок и временной папки);
* скрепка в нижней капсуле открывает проводник Windows с фильтром
  `jpg/png/webp/pdf/step/stp/stl/obj/glb/gltf` (`dialog:allow-open` + `fs:allow-read-file`);
* движок (`ikguide-vision.exe`, `ikguide-cad.exe`) вшит в установщик ресурсами (`bundle.resources`),
  поэтому человеку для работы нужен **ровно один файл** — `IKGuide-Studio-Setup.exe`;
* при старте приложение само поднимает оба сервиса из папки `engine` рядом с `.exe` — без окна
  консоли (`CREATE_NO_WINDOW`). Если файлов нет, оно молча работает с уже запущенным сервером
  на 127.0.0.1:8000/8001;
* если плагины недоступны (другая сборка, отменённый диалог), UI тихо откатывается к обычному
  скачиванию — пользователь всё равно получает файл;
* диалога печати нет: продукт создаёт `.pdf`, а не print job.

## Сборка

```bash
npm run build              # пакеты + веб-бандл (нужен для generate_context!)
npm run desktop:dev        # разработка: Vite + нативное окно
npm run desktop:build      # NSIS/MSI установщик
npm run desktop:icons      # перерисовать иконки (PNG/ICO/ICNS)
```

В Linux-песочнице Rust нет (`rustc`/`cargo` отсутствуют), поэтому `.exe` собирается на Windows или в
GitHub Actions: workflow **Build Windows .exe** (`.github/workflows/release-builds.yml`) — запуск
вручную в один клик или тегом `v*`. Конфигурация при этом проверяется локально:
`npm run check:native`.

## Адреса сервисов

В `.exe` относительный `/v1/...` бессмысленен, поэтому UI обращается к локальному бэкенду:
`http://127.0.0.1:8000` (распознавание) и `http://127.0.0.1:8001` (3D). Запуск — `scripts/start-backend.bat`
из архива `ikguide-backend` или `npm run backend` в репозитории. Демо и `.glb` работают и без сервисов.

## Что выгружается

| Артефакт | Что внутри |
| --- | --- |
| `ikguide-studio-windows` | `IKGuide-Studio-Setup.exe` (NSIS, всё внутри), `IKGuide-Studio-Portable-lite.exe` (без движка) |
| `ikguide-engine-windows` | `engine/ikguide-vision.exe`, `engine/ikguide-cad.exe` (PyInstaller) — они же вшиваются в установщик |
| `ikguide-backend` | архив с Python-сервисами и `scripts/start-backend.bat` для случая «движок уже стоит отдельно» |

Установщик ставится в профиль пользователя (`currentUser`), права администратора не нужны. WebView2 в
Windows 10/11 уже есть; NSIS при необходимости подтянет его сам. В релиз уходит один файл —
`IKGuide-Studio-Setup.exe`.
