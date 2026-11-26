# Архитектура IkGuide

Документ фиксирует решения этапа 1 и дорожную карту этапов 2–4. Главная мысль: **ядро продукта не зависит
от LLM и от платформы**. Фронтенд один, оболочки разные, распознавание — отдельный сервис, который обязан
отдавать данные в тот же формат `.ikguide.json`, что и ручной редактор.

---

## 1. Принципы

1. **Детерминизм вместо генерации.** Все переводы ГОСТ/ЕСКД считаются по таблицам и формулам. Один и тот же
   шифр всегда даёт один и тот же ответ — это проверяется тестами и не «плывёт» между версиями.
2. **Anti-hallucination как свойство формата, а не интерфейса.** У каждого обозначения есть `confidence` и
   `confirmedByHuman`. Порог `0.95` живёт в `@ikguide/schema`, поэтому ни OCR, ни будущий LLM-слой не могут
   обойти подтверждение человеком.
3. **Один UI — две оболочки.** `apps/studio-web` собирается как SPA с относительным `base`, поэтому его без
   изменений загружают Tauri (Windows `.exe`) и Capacitor (Android `.apk`).
4. **Source-first монорепо.** Пакеты экспортируют TypeScript из `src`, Vite транспилирует их на лету, а
   `tsc -p tsconfig.build.json` дополнительно выпускает `dist/` с `.d.ts` для будущих потребителей.
5. **Русский язык — только в UI и текстах.** Идентификаторы, типы, имена файлов, комментарии — английские.

---

## 2. Карта модулей

```
                 ┌──────────────────────────────────────────────┐
                 │            apps/studio-web (React)          │
                 │  worker (6 экранов) │ engineer (Freeform)   │
                 │  print A4 │ QR │ speech ru-RU │ upload       │
                 └───────────────┬──────────────┬──────────────┘
                                 │              │
             @ikguide/schema ────┘              └──── @ikguide/gost-translator
             (Zod-документ,             (таблицы ГОСТ + детерминированные
              порог 0.95, IO,            парсеры резьб, посадок,
              moveStep, статистика)       шероховатости, швов, фасок)

  services/vision-api (Python FastAPI)        @ikguide/builder
  /v1/recognize · /v1/recognize/roi    →      vision-ответ → черновик
  OpenCV + PyMuPDF + RapidOCR                 инструмент, 5 стадий, QC,
  (только обозначения и координаты)           xrayAnnotations, ручные шифры
                                 │
                                 ▼
                       .ikguide.json (schemaVersion "1.0")
                                 ▲
        @ikguide/builder (cad.ts)│
        buildGuideFromCad        │
        mergeCadUpdate           │
                                 │
  services/cad-api (Python FastAPI)
  /v1/cad/import · /v1/cad/render-view
  trimesh + cascadio → GLB + IKEA SVG
```

### Ключевые типы

| Тип | Где | Роль |
| --- | --- | --- |
| `IkGuideDocument` | `packages/ikguide-schema/src/schema.ts` | Единый документ инструкции |
| `XrayAnnotation` | там же | Обозначение на листе: `raw`, `kind`, `xPercent/yPercent`, `confidence`, `confirmedByHuman`, `ambiguousOptions`, `resolvedValue` |
| `TranslationResult` | `packages/gost-translator/src/types.ts` | Дискриминированное объединение ответов переводчика |
| `VisionRecognizeResponse` / `VisionCandidate` | `packages/ikguide-builder/src/types.ts` | Ответ сервиса распознавания: листы, штамп, обозначения с координатами и уверенностью |
| `BuildOptions` | там же | Параметры сборки черновика: автор, `manualNotations`, лимит аннотаций |
| `StepIllustration` | схема | `illustrationId` + слои подсветки `highlight[]` + `arrows[]` — схема шага хранится как данные, а не как картинка |
| `Assembly3D` / `AssemblyPart` | `packages/ikguide-schema/src/schema.ts` | Необязательный блок 3D-сборки: GLB (data URL или ссылка), формат-источник, габариты, детали с `nodeName`, ролью, номером шага и вектором сборки |
| `CadImportResponse` | `packages/ikguide-builder/src/types.ts` | Ответ `POST /v1/cad/import`: детали, шаги с готовым SVG, base64-GLB, предупреждения, статистика |
| `CadChangeSummary` | там же | Что изменилось при слиянии ревизий: `added`, `removed`, `changed`, `keptEdits` |

Слой подсветки (`shapeId → accent | danger | done`) — это и есть «2D-слои» из брифа: один и тот же SVG
перекрашивается под текущий шаг, поэтому не нужно рисовать отдельную иллюстрацию на каждое действие.

---

## 3. Поток данных (целевой)

1. Инженер фотографирует лист (умная камера) или импортирует PDF/PNG/JPEG — «Чертёж → инструкция».
2. `POST /v1/recognize` возвращает листы, штамп и обозначения с координатами и `confidence`
   (векторный слой PDF — точно, фото — через RapidOCR).
3. `buildGuideFromVision()` превращает ответ в черновик `.ikguide.json`: инструмент по обозначениям,
   пять стадий обработки, контрольные точки, `xrayAnnotations`. Спорное — в «Рентген» на подтверждение.
4. Схема валидирует документ; всё с `confidence < 0.95` подсвечивается и требует подтверждения человеком.
4. Инженер правит текст шагов и анти-ошибки на холсте, добавляет подсветку и стрелки.
6. Экспорт `.ikguide.json` или QR → цеховое приложение.
7. Рабочий проходит шаги, подтверждает спорные размеры (если инженер ещё не сделал этого), закрывает чек-лист.
8. Результат (кто, когда, какие подтверждения) — в журнал следующих этапов.

---

## 4. Этап 2 — сервис распознавания (реализован)

### Стек (фактический: только CPU, без LLM, без сетевых моделей)
- **FastAPI + Pydantic v2 + uvicorn** — `services/vision-api`, `app/main.py`.
- **OpenCV headless 5.x** — автоопределение листа, перспективная коррекция, выравнивание по кромке,
  бинаризация Сауволы, поиск рамки и штампа, оценка качества (пересвет, смаз, контраст).
- **PyMuPDF** — векторные PDF: текст берётся из символьного слоя, поэтому координаты точные,
  а уверенность 0.99 (никакого OCR для цифрового чертежа).
- **RapidOCR (ONNX)** — фото и растры. Опционален: если пакет не установлен, сервис поднимается и
  отвечает `ocr: "none"` + предупреждение `ocr_unavailable`, векторные PDF при этом работают.
- **Pillow** — превью листа (PNG data URL), которое «Рентген» использует как подложку.
- Все таблицы значений — те же, что в TS-ядре (порог 0.95, сверло под резьбу, классы шероховатости);
  сервис **не** строит шаги инструкции.

### Контракт API

```
GET  /health
→ { "status": "ok", "service": "ikguide-vision-api", "version": "1.0.0",
    "opencv": "5.1.0", "ocr": "rapidocr" | "none", "ocrAvailable": true,
    "maxPages": 8, "confidenceThreshold": 0.95 }

POST /v1/recognize          multipart/form-data, поле files (до 6 файлов: PDF/PNG/JPEG/WebP, ≤ 25 МБ)
→ 200 {
    "schemaVersion": "1.0",
    "requestId": "3f9c…",
    "engine": "pdf_vector" | "ocr",
    "pages": [{ "pageIndex": 0, "pageId": "pg-1", "source": "pdf_vector",
                "width": 1638, "height": 1158, "dpi": 140,
                "perspectiveCorrected": false, "warnings": [],
                "imageDataUrl": "data:image/png;base64,…" }],
    "titleBlock": { "name": "Кронштейн", "code": "КС-04.100.000 СБ",
                    "material": "09Г2С", "scale": "1:2", "sheet": "1",
                    "confidence": 0.95, "rawLines": ["…"] } | null,
    "candidates": [{ "id": "p0-c1", "pageIndex": 0,
                     "rawText": "Ø20 H7", "normalizedText": "Ø20 H7",
                     "xPercent": 41.2, "yPercent": 37.4,
                     "bboxPercent": { "x": 39, "y": 36, "w": 6, "h": 3 },
                     "confidence": 0.99, "ambiguousOptions": [],
                     "region": "field" | "title_block", "source": "pdf" | "ocr" }],
    "warnings": ["Лист 1: перспектива выправлена автоматически."]
  }
→ 422 { "detail": "Слишком маленькое изображение: минимум 640×480 px" }

POST /v1/recognize/roi       JSON { "pageId": "pg-1", "x": 10, "y": 20, "w": 15, "h": 8, "rotation": 0 }
→ 200 { "pageId": "pg-1", "candidates": [ … ], "warnings": [ … ] }
```

Правила:
- сервис **не** придумывает шаги, инструмент и анти-ошибки — только обозначения и координаты;
- `confidence` ниже 0.95 никогда не «округляется вверх»; OCR-двусмысленность (`М8-7H` / `М8-6H`)
  отдаётся в `ambiguousOptions` и ограничивается 0.92;
- координаты — проценты от листа, поэтому подложка масштабируется на любом экране;
- ROI-эндпоинт работает по `pageId` последнего распознанного листа: инженер обводит пропущенный
  размер, и сервис перечитывает только эту область.

### Сборка черновика: `@ikguide/builder`
`buildGuideFromVision(response, options)` — чистый TS, без сети и без DOM:

1. **Штамп** → `metadata` (название, шифр, материал, масштаб). Нет штампа — `Шифр уточняется` + предупреждение.
2. **Обозначения** → `translateEngineeringNotation()` из ГОСТ-ядра; `kind: "unknown"` не попадает в шаги,
   но остаётся в «Рентгене» как примечание (`SkippedCandidate.reason`).
3. **Инструмент** — политика на семейство: `М8 → сверло Ø6,8 + метчик + калибр`, `Ø20 H7 → развёртка + калибр`,
   `Т1-К5 → сварочный инвертор + шаблон УШС-3`. Вспомогательный «каталог» переводчика (лупа, набор образцов)
   в инструкцию не тянется. Дубликаты склеиваются по названию.
4. **Шаги** — канонические стадии: подготовка → разметка → отверстия/резьба → чистовая/сварка → контроль.
   Пустые стадии отбрасываются, номера пересчитываются без пропусков.
5. **Контрольные точки** — из посадок (мкм), резьбы (калибр), шероховатости (образцы), швов (УШС-3).
6. **Ручные шифры** (`BuildOptions.manualNotations`) добавляются как подтверждённые человеком аннотации
   (`confidence: 1`, `confirmedByHuman: true`) — это и есть «проверить любой шифр» из «Рентгена».

Идентификатор документа детерминирован: `guide-<slug(шифр)>-<fnv1a8(шифр|ревизия|nАннотаций|nШагов)>`,
поэтому повторная сборка заменяет черновик, а не плодит копии.

### Интеграция с фронтендом
- В dev: Vite `server.proxy` — `/v1` и `/health` → `VITE_VISION_API_URL` (по умолчанию `http://127.0.0.1:8000`).
  Браузер всегда обращается к относительным путям, поэтому CORS и адреса превью не мешают.
- Запуск: `npm run dev:vision` (создаёт `.venv`, ставит зависимости, поднимает uvicorn на `0.0.0.0:8000`).
- «Умная камера» (`SmartCamera.tsx`): `getUserMedia` (задняя камера), оценка яркости и резкости
  (дисперсия лапласиана) раз в 400 мс, подсказка «поднимите телефон / больше света», съёмка в JPEG.
- `ScanDialog.tsx`: проверка `/health` → загрузка → стадии «выравниваем, снимаем тени, ищем штамп,
  переводим ГОСТ» → карточка результата (листов, распознано, на проверку, инструментов, контрольных точек).
  Сервис офлайн — это не ошибка: диалог объясняет `npm run dev:vision` и предлагает ручной путь.
- «Рентген» (`XrayScreen.tsx`): тап по пину — перевод; «⌖ Выделить область» — рамка поверх листа →
  `POST /v1/recognize/roi` → «Добавить в черновик»; ручной шифр добавляется кнопкой в карточке перевода.

### Тесты этапа 2
- `services/vision-api/tests` — **98 pytest**: синтетические листы (A4 297×210 мм, штамп 185×55 мм,
  колонки 110/135/165 мм), векторный PDF, фото-имитация (шум, поворот, тень), перспектива, качество,
  нормализация OCR-строк, `/v1/recognize` через `TestClient`, ROI, лимиты и ошибки.
  Фото-тесты проверяют геометрию и цифровые токены, но не кириллические имена: OCR фото
  латинизирует кириллицу — это осознанное ограничение, а не баг.
- `packages/ikguide-builder/src/builder.test.ts` — **18 тестов**: стадии, инструмент, QC, fallback-и,
  лимиты, ручные шифры, повторная сборка.
- UI: `ScanDialog.test.tsx` (офлайн, успех, 422), `XrayScreen.test.tsx` (ROI и ручной шифр → черновик),
  `lib/vision.test.ts` (контракт клиента), reducer-тесты на все новые действия.

## 5. Этап 3 — 3D-конвейер (реализован)

Цель этапа: из обычной 3D-модели узла получить **то же самое**, что этап 2 делает из чертежа —
пошаговую инструкцию с картинками IKEA, только картинки теперь считаются из геометрии, а не рисуются руками.

### 5.1 Стек (фактический)

| Компонент | Роль | Почему он |
| --- | --- | --- |
| `trimesh` 5.2 | чтение STL/OBJ/GLB/GLTF, объёмы, AABB, упаковка GLB | чистый Python + numpy, без OpenGL |
| `numpy` / `scipy` | матрицы, нормали, статистика | база для trimesh и секвенсора |
| `cascadio` 0.1 | тесселяция STEP | единственный пресет-конвертер, который ставится в headless-контейнере |
| `fast-simplification` | децимация до ~900 треугольников на деталь | схемы остаются лёгкими (< 100 КБ) |
| `fastapi` / `uvicorn` | HTTP-контракт | тот же стиль, что у `vision-api` |

`cadquery-ocp`/`OCP` **не используются**: их импорт требует `libGL.so.1`, которого нет в контейнере.
Сервис сам сообщает это в `/health` (`stepEnabled: false`) и просит GLB/STL — это штатный режим, а не авария.

### 5.2 Контракт API

```
GET  /health            → {status, service:"ikguide-cad-api", trimesh, stepEnabled, stepEngine,
                           formats, maxUploadMb, maxParts, svgPalette{...}, sessions}
GET  /v1/cad/health     → то же (через прокси студии)
POST /v1/cad/import     (multipart file) →
     { schemaVersion:"1.0", sessionId:"cad-…",
       assembly{name, filename, sourceFormat, unitScale, sizeMm, massKg},
       parts[{id, name, nodeName, role, bbox{min,max,size}, volumeMm3, centroid,
              triangleCount, explosionVector, groupKey, notation}],
       steps[{number, kind, title, workerText, partIds, count, explosionVector,
              azimuth, elevation, fastenerKey, notation, attention, svg}],
       overviewSvg, glbDataUrl, warnings, stats{parts,fasteners,steps,triangles} }
POST /v1/cad/render-view → {svg, azimuth, elevation, triangles}
```

Ошибки всегда JSON `{detail, code}` с русским `detail`: `unsupported_format`, `cad_unreadable`,
`cad_empty`, `step_engine_missing`, `step_engine_failed`, `step_empty`, `file_too_large`, `session_not_found`.

### 5.3 Как строится порядок сборки (`app/sequencer.py`)

1. **Классификация.** `base` — самая большая/тяжёлая/центральная деталь; `fastener` — по названию
   (`болт|винт|гайка|шайба|шпилька|DIN|ГОСТ|М4…М10`) или по малому объёму с цилиндрической вытянутостью;
   остальное — `part`.
2. **Граф касаний** по AABB с допуском `CONTACT_TOLERANCE_MM`. Деталь «снимается», если у неё есть
   свободное направление (наименьшее перекрытие по ±X/±Y/±Z) — это и есть `explosionVector`.
3. **Разборка снаружи внутрь**, затем инверсия: снятое первым становится последним шагом.
   Базовая деталь остаётся в руках дольше всех → шаг 1.
4. **Склейка крепежа**: одинаковые крепёжники одного узла (`groupKey`) → один шаг с правильно
   склонённым количеством: «Надень 4 шайбы 6», «Закрути 4 болта М6×20».
5. Проверка `assembly_order_is_consistent`: шаги не пересекаются по объёму в момент установки,
   иначе в `warnings` попадает честная пометка.

### 5.4 IKEA SVG (`app/ikea_svg.py`)

- Проекция вершин при произвольных `(azimuth, elevation)`, отсечение задних граней, сортировка по глубине.
- Рёбра: silhouette (граница силуэта) + crease (перегиб больше порога) — именно то, что делает картинку
  «чертёжной», а не «фотографией».
- Ровно три смысловых цвета: установленное — заливка `#FFFFFF`/`#F2F4F7`, контур `#1D1D1F`;
  активная деталь — `#E8F2FF` + `#007AFF`, сдвинута по своему вектору, ось пунктиром `7 6` и жирная синяя
  стрелка; критическая ориентация — `#FF3B30` (кружок «!» и подпись).
- Никакого растра: `viewBox="0 0 720 520"`, ноль `<image>`, поэтому схема печатается без потерь и
  масштабируется в А4.

### 5.5 Сборка инструкции (`packages/ikguide-builder/src/cad.ts`)

- `buildGuideFromCad(response, options)` → полноценный `IkGuideDocument`: ГОСТ-перевод названий крепежа
  (`Болт М6x20` → «Болт М6×20, ключ 10 мм, момент 8 Н·м»), тексты шагов человеческим языком, крест-накрест
  для многоболтовых узлов, инструмент (`Ключ N мм`, `Динамометрический ключ 2–24 Н·м`, `Штангенциркуль`,
  `Киянка`), BOM с группировкой (`Болт М6×20 ×4`), чек-лист ОТК (момент, вращение вала, комплектность).
- `mergeCadUpdate(previous, response, options)` — «одно обновление = новая инструкция»:
  детали сопоставляются по `nodeName` (fallback — по `displayName`), шаги — по набору `activePartIds`.
  Любое расхождение с только что сгенерированным текстом считается правкой человека и **побеждает**:
  сохраняются `title`, `workerText`, `antiError`, `criticalChecks`, `cameraView`, плюс чек-лист и
  `xrayAnnotations` предыдущего документа. Ревизия растёт `A → B`, возвращается сводка
  `{added, removed, changed, keptEdits, partsBefore, partsAfter, …}` и текст тоста.

### 5.6 Фронтенд

- **Vite-прокси**: `/v1/cad` → `VITE_CAD_API_URL` (по умолчанию `http://127.0.0.1:8001`), объявлен
  **раньше** общего `/v1` → запросы CAD никогда не уходят в `vision-api`. В браузере — только
  относительные URL, поэтому сборка работает и внутри Tauri/Capacitor.
- **`Assembly3DViewer` + `lib/assembly3d.ts`** (three.js, отдельный чанк `Assembly3DViewer`):
  установленные — матовый белый пластик с тёмным контуром (`EdgesGeometry`), активная — `#007AFF`
  с подсветкой и «влётом» по оси, будущие — призрачный контур (переключатель), орбита/зум мышью и пальцем,
  слайдер «Разнести / Собрать», «Повторить анимацию установки». Нет WebGL → аккуратная подсказка,
  IKEA-схема остаётся.
- **`lib/ikeaSvg.ts`** — офлайн-близнец серверного рендера (силуэты AABB, та же палитра, тот же `viewBox`).
  Нужен, когда сервис выключен: демо и любой шаг всё равно получают схему.
- **`lib/cadOffline.ts`** — разбор `.glb/.gltf` прямо в браузере через `GLTFLoader`: детали по именам узлов,
  габариты, черновой порядок, готовый `CadImportResponse` → `buildGuideFromCad`. Формат STEP честно просит
  `npm run dev:cad`.
- **Перегруппировка** (`lib/steps3d.ts`): «Влить в предыдущий» и «Отделить деталь» — чистые функции над
  документом: перенумерация `1…n`, пересчёт `activePartIds`/`installedPartIds`/`stepNumber`, перерисовка
  IKEA-схем из сохранённых центров деталей (`centerMm`) без обращения к сервису.
- **Демо «Узел привода УП-08»**: `scripts/build-demo-3d.py` строит процедурную сборку (12 деталей),
  прогоняет её через настоящий `loader + sequencer` и записывает `apps/studio-web/src/data/up08-assembly.ts`
  (data URL GLB + детали + шаги). Ни сети, ни сервиса, ни внешних ассетов.

### 5.7 Тесты этапа 3

- `services/cad-api/tests` (44 pytest): синтетические STL (бинарный без заголовка), OBJ с группами,
  GLB-сборка, STEP-текст; нормализация единиц, роли и группировка крепежа, порядок без пересечений,
  валидность SVG (XML, палитра, пунктир, `attention`), `/health`, `/v1/cad/import`, `/v1/cad/render-view`, 4xx.
- `packages/ikguide-builder/src/cad.test.ts` (14): ГОСТ-названия, 4+4 BOM, момент и ключ, шаги ↔ детали,
  QC, предупреждения о плейсхолдерах, `mergeCadUpdate` (сохранение `antiError`, ручного текста и ракурса).
- `packages/ikguide-schema/src/schema.test.ts` (+8): новые 3D-поля, обратная совместимость старых документов.
- `apps/studio-web`: `ikeaSvg.test.ts` (9), `demo3d.test.ts` (7), `cadOffline.test.ts` (4), `cad.test.ts` (6),
  `steps3d.test.ts` (6) — слияние/разделение шагов с перенумерацией и перерисовкой схем, reducer (2D↔3D),
  smoke-тест переключателя «Схема IKEA / 3D-модель».

---

## 6. Этап 4 — упаковка `.exe` и `.apk` (реализован)

Один и тот же бандл `apps/studio-web/dist` живёт в трёх оболочках; различия между ними собраны в одном
модуле — `apps/studio-web/src/lib/runtimeConfig.ts`.

| Оболочка | Определение | Стартовый режим | Базовый URL сервисов |
| --- | --- | --- | --- |
| Браузер / dev / preview | ни `__TAURI__`, ни `Capacitor.isNativePlatform()` | Рабочий | `''` → относительные `/v1/...`, прокси Vite |
| Windows `.exe` | `window.__TAURI_INTERNALS__` / `__TAURI__` | Инженер (Freeform) | сохранённый адрес, иначе `http://127.0.0.1:8000` / `:8001` |
| Android `.apk` | `window.Capacitor.isNativePlatform()` | Рабочий | сохранённый адрес, иначе те же локальные порты (в цехе — LAN-IP ноутбука) |

`joinUrl(base, path)` — единственное место, где склеивается адрес: `sanitizeBaseUrl` принимает только
абсолютные `http(s)`-адреса, поэтому опечатка вроде `192.168.1.50:8000` не превращается в запрос «в никуда».
`visionBaseUrl()` / `cadBaseUrl()` в клиентах обоих сервисов берут адрес оттуда же, поэтому в браузере и в
`web_accessible`-тестах пути остаются относительными (`/v1/recognize`, `/v1/cad/health`).

### 6.1 «Настройки и подключение» и «Проверить связь»
`components/common/SettingsDialog.tsx` + `probeConnection()` в `runtimeConfig.ts`:
- два поля адресов с подсказкой итогового URL, кнопка «Подставить» с LAN-адресом хоста, который отдал UI;
- «Проверить связь» параллельно дергает `/health` и `/v1/cad/health` (таймаут 5 с), показывает задержку,
  версию OpenCV, движок OCR (`tesseract`, `rapidocr` или «не найден») и доступность STEP (`stepEnabled`,
  `stepEngine`), различая «сервис ответил 503» и «сервис не отвечает»;
- «Строгий режим цеха» прячет редактор инженера **только на нативной оболочке**
  (`canSwitchToEngineer(runtime, settings)`); в браузере редактор остаётся доступным для разработки;
- панель «Устройство»: имя оболочки, фактический бэкенд офлайн-хранилища и число инструкций на устройстве.

### 6.2 Офлайн-библиотека — `lib/offlineStore.ts`
Три уровня хранения: IndexedDB (`ikguide-offline`, store `guides`, keyPath `id`) → `localStorage`
(`ikguide.offline.v1`) → память. Каждая запись `StoredGuide { id, doc, savedAt, source, pinned }`:
`source` = `engineer | scan | qr | import | demo`. Документ валидируется схемой при сохранении (битый
документ не попадает в хранилище), повреждённые записи игнорируются при чтении, `persistGuide()` никогда
не бросает исключение — его вызывают обработчики кликов. Пин «Доступно офлайн» переживает повторное
сохранение того же документа; `storeBackendName()` показывает фактический бэкенд в диалоге настроек.

### 6.3 QR-мост — `lib/qrBridge.ts`
```
документ → JSON → fflate(level 9) → base64url → <base>/?g=<payload>
```
Обратный путь: `extractPayload()` понимает полную ссылку, `#/?g=…`, «сырой» payload и `?guide=<id>`;
`decodeGuidePayload()` распаковывает, проверяет схему и объясняет ошибку по-русски.

Ёмкость одного QR — ~2.5 КБ (`QR_MAX_BYTES`), поэтому `qrVariants()` строит лестницу деградации, и каждая
ступень обязана пройти схему:

| Ступень | Что остаётся | Что теряется | Предупреждение |
| --- | --- | --- | --- |
| 1 | весь документ | — | — |
| 2 | шаги, инструмент, ГОСТ-переводы, SVG | `.glb` (в `assembly3d` остаётся заглушка `about:blank#glb-stripped`) | «В QR упакованы все шаги, инструмент, ГОСТ-переводы и SVG-схемы; для полного 3D-файла передайте пакет `.ikguide.json` по сети.» |
| 3 | шаги + SVG + чек-лист | блок `assembly3d` целиком | «3D-узел не помещается в QR…» |
| 4 | шаги без SVG | SVG-схемы | «SVG-схемы не помещаются в QR…» |
| 5 | текст шагов, контроль, инструмент, чек-лист | разметка иллюстраций, якоря чертежа | — |
| 6 | то же, но без переводов обозначений | `xrayAnnotations` + `drawingRefs` | «ГОСТ-переводы обозначений не помещаются…» |

Если не влезает и ступень 6, результат помечается `tooLarge` + `suggestion: 'link'`: ссылка рабочая,
QR — нет, и диалог честно предлагает вкладку «QR по цеховой ссылке» или пакет/HTML. Дублирующиеся ступени
отбрасываются сравнением сериализованного документа, чтобы список предупреждений не врал.

Вторая вкладка — `buildWorkshopLink(baseUrl, guideId)` → `<цеховой адрес>/?guide=<id>` (без адреса —
`ikguide://guide/<id>`): 60-байтная ссылка, работает на `.apk` и на iPhone, но требует сети цеха.

Пакеты: `buildOfflinePackage()` → `.ikguide.json`; `buildStandaloneHtml()` → один `.html` без скриптов,
внешних ссылок и `src=`: инлайн-стили, встроенные SVG шагов, BOM, инструмент, анти-ошибки, чек-лист и
`@media print`; весь пользовательский текст экранируется, SVG проходит `sanitizeSvgMarkup`.

### 6.4 Сканер QR — `components/common/QrScannerDialog.tsx`
`getUserMedia({ facingMode: 'environment' })` → видео → кадр ≤640 px на canvas → `jsqr` (чистый JS,
загружается динамически, кадры не покидают устройство) → рамка прицела и статус. Дополнительно: фото
кода из галереи (тот же `jsqr` по `Image`) и ручное поле для ссылки/кода. Успех: `decodeGuidePayload` →
`adoptGuide(doc, 'scan' | 'qr')` → сохранение в офлайн-библиотеку → «Перед началом работы».
`useBootLink()` в `App.tsx` повторяет то же для `?g=…` и `?guide=<id>` при старте приложения.

### 6.5 Нативные оболочки
**Windows `.exe` — Tauri 2** (`apps/desktop-tauri`):
- `productName: IKGuide Studio`, окно «ИК-Гайд Инженер» 1360×860 (минимум 960×640), `identifier ru.ikguide.studio`;
- `frontendDist: ../../../apps/studio-web/dist`; `beforeBuildCommand` → `npm run build --prefix ../..` (пакеты ядра +
  студия, иначе Vite не найдёт `dist` схемы), `beforeDevCommand` → `build:packages` + dev-сервер студии;
- плагины `dialog` + `fs`; `src-tauri/src/lib.rs` отдаёт команды `print_sheet` (печать через `window.print()`
  в системный диалог) и `shell_version`;
- capabilities (`src-tauri/capabilities/default.json`): `core:default`, `dialog:default/allow-open/allow-save`,
  `fs:default` + чтение/запись текстовых файлов в `$HOME`, `$DESKTOP`, `$DOCUMENT`, `$DOWNLOAD`, `$TEMP`;
- CSP: `script-src 'self'`, картинки — `data:`/`blob:`; `connect-src` разрешает любой `http(s)`, потому
  что адрес цехового сервера задаёт инженер (`192.168.x.y:8000`), и перечислить подсети в CSP нельзя.
  Компенсация: скрипты только свои, никакой внешней загрузки, а сам адрес виден и проверяем в настройках;
- фронтенд (`lib/nativeExport.ts`) в Tauri-режиме меняет «Скачать» на «Сохранить на диск»: нативный `save()`
  → `writeTextFile()`, а при отсутствии плагина — обычное скачивание браузера (деградация, не падение).

**Android `.apk` — Capacitor 6** (`apps/mobile-capacitor`): `appId ru.ikguide.worker`, `appName «ИК-Гайд Цех»`,
`webDir ../../apps/studio-web/dist`, `androidScheme https` + `cleartext: true`; полный Gradle-проект
`android/` (wrapper 8.x, AGP 8.2.1, Java 17, compileSdk 34) закоммичен; `AndroidManifest.xml` объявляет
`INTERNET`, `ACCESS_NETWORK_STATE`, `CAMERA` (+ `uses-feature camera required=false`),
`READ_MEDIA_IMAGES` и `READ_EXTERNAL_STORAGE` (maxSdk 32); `res/xml/network_security_config.xml` разрешают
cleartext для цеховой сети. Камеру внутри WebView обрабатывает штатный `BridgeWebChromeClient` Capacitor:
он сам запрашивает разрешение `CAMERA` у Android. Иконки и сплэши — из `scripts/build-icons.py`.

### 6.6 Сборка и CI
`.github/workflows/ci.yml`: `web-and-tests` (Node 20, `npm ci` → `typecheck` → `test` → `build`),
`python-services` (Python 3.11, оба `requirements*.txt`, pytest обоих сервисов) и `rust-tauri-check` (`cargo check` в `apps/desktop-tauri/src-tauri` на ubuntu с системными библиотеками
Tauri) и `config-syntax` (`node scripts/check-native-configs.mjs`).

`.github/workflows/release-builds.yml` (тег `v*` и `workflow_dispatch`):
- `build-windows-exe` — `windows-latest`, Node 20, `dtolnay/rust-toolchain@stable` + `Swatinem/rust-cache`,
  `npm ci` → `npm run build` → `npm --prefix apps/desktop-tauri run build -- --bundles nsis,msi`,
  артефакт `ikguide-studio-windows` (`ikguide-studio-windows.exe` + `ikguide-studio-setup.exe`);
- `build-android-apk` — `ubuntu-latest`, Node 20, Java 17 temurin, `android-actions/setup-android@v3`,
  `npm ci` → `npm run build` → `npm --prefix apps/mobile-capacitor run sync` → `./gradlew assembleDebug`,
  опциональный `assembleRelease` из секретов (шаг `continue-on-error`, без секретов workflow зелёный),
  артефакт `ikguide-worker-android`;
- `build-portable-backend` — архив сервисов + `start-workshop-servers.bat|sh` для ПК цеха;
- по тегу всё прикрепляется к GitHub Release (`softprops/action-gh-release`).

**Честная граница:** в песочнице разработки нет `rustc`, `cargo`, JDK, Gradle и Android SDK, поэтому
`cargo check` и `assembleDebug` здесь не запускались. Вместо «зелёного статуса из воздуха» —
`npm run check:native`: 127 статических проверок (пути Tauri, `Cargo.toml`, capabilities, манифест и
`network_security_config.xml` как XML, размеры всех PNG-иконок по заголовку файла, оба workflow через
YAML-парсер, CRLF у `.bat`). Компиляцию выполняют раннеры GitHub Actions.

---

## 7. Качество и CI

| Гейт | Команда | Текущий результат |
| --- | --- | --- |
| Unit-тесты | `npm test` | 242 теста, 23 файла, зелёные |
| Сервис распознавания | `npm run test:vision` | 98 pytest, зелёные |
| Сервис 3D-моделей | `npm run test:cad` | 44 pytest, зелёные |
| Типы | `npm run typecheck` | 0 ошибок, strict |
| Сборка | `npm run build` | пакеты `tsc` + Vite OK; three.js и jsQR — отдельные чанки |
| Нативные конфиги | `npm run check:native` | 127 проверок Tauri/Capacitor/workflow/иконок, 0 провалов |

Правила:
- новые таблицы ГОСТ — только вместе с тестами на граничные значения (номинал 3, 30, 500 мм; шаг; класс);
- изменение схемы — только с миграцией и тестом обратной совместимости;
- запрещены «магические» числа в UI: значения берутся из ядра;
- smoke-тест (`App.smoke.test.tsx`) прогоняет реальные клики: главная → проверка → шаги → рентген → инженер →
  чек-лист → финиш;
- сканирование проверяется с подменённым `fetch`: офлайн-сервис, успешное распознавание, отказ 422,
  ROI и ручной шифр — без запуска Python внутри Vitest;
- Python-тесты не зависят от сети и моделей: всё на синтетических листах/мешах, OCR-тесты помечены `skipif`,
  если `rapidocr` не установлен;
- 3D-тесты не зависят от внешних CAD-файлов: `.stl/.obj/.glb/.step` собираются в памяти теста;
- `three.js` нельзя тянуть в основной бандл: он импортируется только из ленивого чанка
  `Assembly3DViewer`/`cadOffline` (проверяется размером сборки).

---

## 8. Риски и как мы их снимаем

| Риск | Влияние | Мера |
| --- | --- | --- |
| OCR «уверенно» врёт | Брак детали | Порог 0.95 в схеме, блокировка чек-листа, ручное подтверждение, `source`/`bbox` для аудита |
| Разъезд таблиц между TS и Python | Разные миллиметры в разных местах | Один JSON-экспорт таблиц, тесты-снапшоты в обоих репозиториях |
| Тяжёлый 3D ломает `.apk` | Отказ цеха | three.js в отдельном чанке, GLB ужимается децимацией ≤ 900 треугольников на деталь, 2D-схемы остаются основным режимом |
| STEP-движок не ставится на сервере | Инженер не может открыть `.step` | `/health` честно отдаёт `stepEnabled:false` + просьбу GLB/STL; браузерный разбор `.glb/.gltf` работает офлайн |
| Автоматический порядок сборки ошибается | Неверная инструкция | Инженер правит шаги на холсте; `mergeCadUpdate` сохраняет правки; в предупреждениях — пометка о несогласованности |
| Тёмная тема и печать | Нечитаемые инструкции | `@media print` фиксирует светлые цвета и A4; арт всегда на белой «бумаге» |
| Потеря документа | Проcтой | Экспорт `.ikguide.json`, офлайн-библиотека (IndexedDB + резерв), автономный HTML, QR с контрольной суммой |
| QR не вмещает инструкцию | Рабочий не получит шаги | Лестница деградации с честными предупреждениями, `tooLarge` → цеховая ссылка/пакет/HTML; каждая ступень проверяется схемой |
| Планшет ищет сервер не там | «Сервис недоступен» на ровном месте | Адрес вводится в UI, «Проверить связь» показывает OpenCV/OCR/STEP и задержку, LAN-подсказка, `sanitizeBaseUrl` не пропускает адрес без схемы |
| Нативная сборка ломается незаметно | Нет `.exe`/`.apk` к обещанному сроку | `check:native` (125 проверок) в CI на каждый push; релизная сборка запускается вручную до тега |
| Камера запрещена политикой планшета | Сканер не работает | Галерея + ручная ссылка как полноценные пути; честное сообщение вместо пустого экрана |

---

## 9. Чек-лист готовности этапа 1

- [x] npm workspaces, единый strict-tsconfig, Vitest
- [x] `@ikguide/schema`: Zod-схема, смысловая валидация, порог 0.95, IO, `moveStep`
- [x] `@ikguide/gost-translator`: резьбы, посадки (точные мкм), шероховатость, швы, фаски, радиусы, отверстия
- [x] UI: 6 экранов рабочего, холст инженера, 2 демо-проекта, SVG в трёх цветах
- [x] Озвучка `ru-RU`, свайпы, клавиатура, крупные кнопки
- [x] Экспорт/импорт `.ikguide.json`, QR, печать A4, localStorage
- [x] Тесты, typecheck, production-сборка
- [x] **Этап 2:** сервис распознавания, «умная камера», ROI, сборка черновика, ручные шифры
- [x] **Этап 3:** `services/cad-api`, IKEA-схемы из геометрии, 3D-просмотр, слияние ревизий
- [ ] Нативные `.exe`/`.apk` — этап 4

## 10. Чек-лист готовности этапа 2

- [x] `services/vision-api`: FastAPI, OpenCV-пайплайн, PyMuPDF для вектора, RapidOCR для фото
- [x] `/health`, `/v1/recognize` (до 6 файлов), `/v1/recognize/roi`, понятные русские ошибки 4xx
- [x] Оценка качества листа: пересвет, смаз, контраст, перспектива, «лист не найден»
- [x] Штамп и обозначения с координатами в процентах; уверенность без «округления вверх»
- [x] `@ikguide/builder`: инструмент по политике семейства, 5 стадий, QC, лимиты, предупреждения
- [x] Ручные шифры (`manualNotations`) → подтверждённые аннотации; повторная сборка заменяет черновик
- [x] Vite-прокси, «умная камера» с подсказками, диалог распознавания, ROI на «Рентгене»
- [x] 98 pytest, 18 тестов сборщика, UI-тесты сканирования и ROI, typecheck и production-сборка
- [x] Офлайн-режим: демо и открытые инструкции работают без сервиса, диалог объясняет запуск

## 11. Чек-лист готовности этапа 3

- [x] `services/cad-api`: FastAPI на 8001, `/health`, `/v1/cad/import`, `/v1/cad/render-view`
- [x] Загрузка `.step/.stp/.stl/.obj/.glb/.gltf`, нормализация единиц и масштаба, центрирование
- [x] Детали со стабильными `node.name`, габаритами, объёмами, центрами масс, векторами сборки
- [x] Классификация `base/part/fastener` по названию и объёму, склейка одинакового крепежа
- [x] Порядок сборки «обратной разборкой» с проверкой непересечения
- [x] IKEA SVG: проекция при любом ракурсе, рёбра силуэта, ровно 3 смысловых цвета + красный акцент
- [x] Схема: `assembly3d`, `activePartIds`, `installedPartIds`, `cameraView`, `svgDiagram` — обратно совместимо
- [x] `buildGuideFromCad`: ГОСТ-тексты, инструмент, BOM с количеством, чек-лист ОТК
- [x] `mergeCadUpdate`: сохранение ручных правок, анти-ошибок, ракурсов, чек-листа; сводка изменений
- [x] three.js-просмотр: белый пластик + синяя активная деталь, анимация по вектору, «Разнести/Собрать»
- [x] Переключатель «Схема IKEA / 3D-модель», спецификация сборки на экране подготовки
- [x] Инженер: загрузка 3D, «Обновить 3D-модель», «Снять IKEA-ракурс», экспорт SVG, SVG в печать А4
- [x] Третье демо «Узел привода УП-08» — процедурный GLB, работает без сети и без сервиса
- [x] Офлайн: `.glb/.gltf` разбираются в браузере, `.step` просит `npm run dev:cad`
- [x] 44 pytest, 14 тестов сборщика, +8 тестов схемы, UI-тесты 3D; `npm test`, `typecheck`, `build`

## 12. Чек-лист готовности этапа 4

- [x] `runtimeConfig.ts`: определение оболочки (`web` / `tauri-desktop` / `capacitor-android`), режим по умолчанию,
      адреса сервисов с сохранением, `sanitizeBaseUrl`, `joinUrl`, LAN-подсказка, чтение `?g=` и `?guide=`
- [x] Все сетевые вызовы (`vision.ts`, `cad.ts`) идут через `visionBaseUrl()`/`cadBaseUrl()`
- [x] «Настройки и подключение»: два адреса, «Проверить связь» (`/health` + `/v1/cad/health`, OpenCV, OCR, STEP),
      «Строгий режим цеха», панель устройства и хранилища
- [x] `offlineStore.ts`: IndexedDB → localStorage → память, пин «Доступно офлайн», удаление, валидация схемы
- [x] Офлайн-библиотека на главном экране рабочего и в панели инженера
- [x] `qrBridge.ts`: fflate + base64url, лестница из шести ступеней с честными предупреждениями, `tooLarge` → ссылка
- [x] Вторая вкладка «QR по цеховой ссылке» (`buildWorkshopLink`, `.apk` и iPhone)
- [x] «Скачать автономный офлайн-пакет (`.ikguide.json`)» и «Экспорт автономного HTML-файла» (без скриптов и сети)
- [x] Сканер QR: живая камера + рамка, фото из галереи, ручная ссылка; сохранение офлайн и переход на «Перед началом работы»
- [x] Автостарт по `?g=…` и `?guide=<id>`
- [x] Tauri 2: `productName IKGuide Studio`, id `ru.ikguide.studio`, окно 1360×860 (min 960×640), NSIS+MSI,
      capabilities dialog/fs, `print_sheet`, нативное открытие/сохранение, иконки `.ico`/`.png`/`.icns`
- [x] Capacitor 6: `ru.ikguide.worker`, «ИК-Гайд Цех», полный `android/`-проект (wrapper 8.x, Java 17, compileSdk 34),
      манифест с CAMERA/INTERNET/READ_MEDIA_IMAGES, `network_security_config.xml`, mipmap-иконки и сплэши
- [x] `scripts/start-workshop-servers.bat|sh` и `scripts/build-icons.py`
- [x] `.github/workflows/ci.yml`: типы, тесты, сборка, оба pytest, проверка конфигов
- [x] `.github/workflows/release-builds.yml`: `.exe` (windows-latest + Rust), `.apk` (ubuntu + Java 17 + SDK),
      архив цехового сервера, Release по тегу `v*`, опциональная подпись из секретов
- [x] Тесты этапа 4: `runtimeConfig` (19), `offlineStore` (9), `qrBridge` (15, включая настоящий round trip «модули → jsQR → документ»), UI-сценарии (4) — всего 242 теста / 23 файла
- [x] `npm run check:native` — 127 статических проверок нативной упаковки, 0 провалов
- [x] `cargo check` вынесен в CI (джоба `rust-tauri-check`): Rust компилируется на каждом push, хотя локально `rustc` нет
- [x] README: как скачать `.exe`/`.apk` через Actions/Release и как поднять цеховой сервер на Windows
