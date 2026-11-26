/**
 * Shop-floor QR bridge: one instruction travelling from the engineer's PC to a worker's phone.
 *
 * Encoding: the `.ikguide.json` is deflated with `fflate` and written as base64url into a portable
 * link `<base>/?g=<payload>`. Opening such a link — on Android, on an iPhone, in any browser, with
 * no app installed — decodes the instruction straight into the worker screen.
 *
 * A QR code physically holds ~2.5 KB, while a 3D assembly can be megabytes and a six-step Russian
 * instruction compresses to 3–6 KB. So the payload degrades in a documented order and *always says
 * what it dropped*:
 *   1. the whole document (small guides fit as-is);
 *   2. drop the GLB — steps, tools, GOST texts and SVG diagrams stay;
 *   3. drop `assembly3d` altogether;
 *   4. drop the per-step SVG diagrams;
 *   5. keep only what a worker reads on the floor: step texts, checks, «нельзя», tools, checklist;
 *   6. drop the GOST translations of the drawing labels.
 * When even rung 6 does not fit a code, `tooLarge` tells the UI to offer the workshop link or the
 * `.ikguide.json` package instead of printing an unreadable QR.
 *
 * Both escape hatches are built here as well: an offline `.ikguide.json` package and a truly
 * standalone `.html` file that opens anywhere, without the app and without a network.
 */
import { compressSync, decompressSync, strFromU8, strToU8 } from 'fflate';
import { ikGuideDocumentSchema, serializeDocument, type IkGuideDocument } from '@ikguide/schema';
import { sanitizeSvgMarkup } from './ikeaSvg';

export const QR_MAX_BYTES = 2500;
export const PAYLOAD_PARAM = 'g';

export interface EncodeOptions {
  /** Absolute base of the app (e.g. `https://shop.local/ikguide/`); empty → relative link. */
  baseUrl?: string;
  /** Soft byte limit of the QR payload. */
  maxBytes?: number;
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  }
  return globalThis
    .btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function base64UrlDecode(value: string): Uint8Array {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  const binary = globalThis.atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

export type QrDrop = 'glb' | 'assembly' | 'diagrams' | 'annotations';

export interface QrVariant {
  doc: IkGuideDocument;
  dropped: QrDrop[];
}

export const DROP_WARNINGS: Readonly<Record<QrDrop, string>> = {
  glb: 'В QR упакованы все шаги, инструмент, ГОСТ-переводы и SVG-схемы; для полного 3D-файла передайте пакет .ikguide.json по сети.',
  assembly: '3D-узел не помещается в QR: остаются шаги, схемы, инструмент и чек-лист.',
  diagrams: 'SVG-схемы не помещаются в QR: они придут вместе с пакетом .ikguide.json.',
  annotations: 'ГОСТ-переводы обозначений не помещаются в QR: полный чертёж — в пакете .ikguide.json.',
};

export function compressDocument(doc: IkGuideDocument): Uint8Array {
  return compressSync(strToU8(JSON.stringify(doc)), { level: 9 });
}

export function decompressDocument(bytes: Uint8Array): unknown {
  return JSON.parse(strFromU8(decompressSync(bytes)));
}

function withoutGlb(doc: IkGuideDocument): IkGuideDocument {
  if (!doc.assembly3d) {
    return doc;
  }
  const { glbDataUrl: _data, glbUrl: _url, ...rest } = doc.assembly3d;
  // The schema requires at least one of the two fields, so a clearly marked placeholder link stays:
  // the worker still sees the assembly size and the part list, but nothing heavy travels in the QR.
  return {
    ...doc,
    assembly3d: { ...rest, glbUrl: 'about:blank#glb-stripped' } as IkGuideDocument['assembly3d'],
  };
}

function withoutAssembly(doc: IkGuideDocument): IkGuideDocument {
  const { assembly3d: _assembly, ...rest } = doc;
  return {
    ...rest,
    steps: rest.steps.map(({ cameraView: _view, ...step }) => {
      const copy = { ...step };
      delete copy.activePartIds;
      delete copy.installedPartIds;
      return copy;
    }),
  };
}

function withoutDiagrams(doc: IkGuideDocument): IkGuideDocument {
  return {
    ...doc,
    steps: doc.steps.map(({ svgDiagram: _svg, ...step }) => step),
  };
}

/**
 * The smallest honest instruction: every step keeps its text, its checks and its «нельзя», the tool
 * list and the checklist stay whole. Only rendering payload (SVG, 3D, illustration markup) and — when
 * it is still too big — the GOST label translations are dropped.
 */
function compactPack(doc: IkGuideDocument, options: { keepAnnotations: boolean }): IkGuideDocument {
  const annotationIds = new Set(doc.xrayAnnotations.map((annotation) => annotation.id));
  return {
    schemaVersion: doc.schemaVersion,
    id: doc.id,
    metadata: doc.metadata,
    drawing: doc.drawing,
    bom: doc.bom,
    tools: doc.tools,
    xrayAnnotations: options.keepAnnotations ? doc.xrayAnnotations : [],
    qcChecklist: doc.qcChecklist,
    steps: doc.steps.map((step) => ({
      id: step.id,
      number: step.number,
      title: step.title,
      workerText: step.workerText,
      estimatedMinutes: step.estimatedMinutes,
      illustration: { illustrationId: `qr-${step.id}`, highlight: [], arrows: [] },
      antiError: step.antiError,
      criticalChecks: step.criticalChecks,
      drawingRefs: options.keepAnnotations ? step.drawingRefs.filter((ref) => annotationIds.has(ref)) : [],
    })),
  };
}

/**
 * Progressive degradation, in the documented order. Each variant is schema-valid by construction —
 * a QR that decodes into a broken instruction would be worse than no QR at all.
 */
export function* qrVariants(doc: IkGuideDocument): Generator<QrVariant> {
  const ladder: Array<() => QrVariant> = [
    () => ({ doc, dropped: [] }),
    () => ({ doc: withoutGlb(doc), dropped: ['glb'] }),
    () => ({ doc: withoutAssembly(withoutGlb(doc)), dropped: ['glb', 'assembly'] }),
    () => ({ doc: withoutDiagrams(withoutAssembly(withoutGlb(doc))), dropped: ['glb', 'assembly', 'diagrams'] }),
    () => ({
      doc: compactPack(withoutAssembly(withoutGlb(doc)), { keepAnnotations: true }),
      dropped: ['glb', 'assembly', 'diagrams'],
    }),
    () => ({
      doc: compactPack(withoutAssembly(withoutGlb(doc)), { keepAnnotations: false }),
      dropped: ['glb', 'assembly', 'diagrams', 'annotations'],
    }),
  ];

  const seen = new Set<string>();

  for (const build of ladder) {
    let variant: QrVariant;
    try {
      variant = build();
    } catch {
      continue;
    }
    const validation = ikGuideDocumentSchema.safeParse(variant.doc);
    if (!validation.success) {
      continue;
    }
    const key = JSON.stringify(validation.data);
    if (seen.has(key)) {
      // Identical to the previous rung: nothing was actually dropped, keep the warnings honest.
      continue;
    }
    seen.add(key);
    yield { doc: validation.data, dropped: variant.dropped };
  }
}

export interface EncodeResult {
  /** Ready-to-show link (`?g=…`). */
  url: string;
  /** Just the base64url payload. */
  payload: string;
  /** Size of the compressed payload in bytes. */
  bytes: number;
  /** Soft byte limit used for this encoding. */
  maxBytes: number;
  /** What this payload no longer contains, in plain Russian. */
  warnings: string[];
  /** Machine-readable list of the same. */
  dropped: QrDrop[];
  /** True when the GLB was removed (the usual case for 3D assemblies). */
  strippedGlb: boolean;
  /** True when even the smallest variant does not fit a QR: the link works, the QR does not. */
  tooLarge: boolean;
  /** What to do instead, when `tooLarge`. */
  suggestion: 'link' | 'package' | null;
}

function buildUrl(base: string, payload: string): string {
  const prefix = base ? `${base.replace(/\/+$/, '')}/` : '/';
  return `${prefix}?${PAYLOAD_PARAM}=${payload}`;
}

/**
 * Packs an instruction into a portable link. Never throws for a valid document — it degrades and
 * reports instead.
 */
export function encodeGuidePayload(doc: IkGuideDocument, options: EncodeOptions = {}): EncodeResult {
  const validation = ikGuideDocumentSchema.safeParse(doc);
  if (!validation.success) {
    throw new Error('Документ не прошёл проверку схемы: упаковать в QR нельзя.');
  }
  const maxBytes = options.maxBytes ?? QR_MAX_BYTES;
  const base = (options.baseUrl ?? '').trim();
  let smallest: EncodeResult | null = null;

  for (const variant of qrVariants(validation.data)) {
    const payload = base64UrlEncode(compressDocument(variant.doc));
    const result: EncodeResult = {
      url: buildUrl(base, payload),
      payload,
      bytes: payload.length,
      maxBytes,
      warnings: variant.dropped.map((kind) => DROP_WARNINGS[kind]),
      dropped: [...variant.dropped],
      strippedGlb: variant.dropped.includes('glb'),
      tooLarge: false,
      suggestion: null,
    };
    if (result.bytes <= maxBytes) {
      return result;
    }
    smallest = result;
  }

  return {
    ...(smallest ?? {
      url: buildUrl(base, ''),
      payload: '',
      bytes: 0,
      maxBytes,
      warnings: [],
      dropped: [] as QrDrop[],
      strippedGlb: false,
    }),
    tooLarge: true,
    suggestion: 'link',
  };
}

/** Accepts a full link, a `?g=…` fragment, a bare payload — anything the scanner may see. */
export function extractPayload(input: string): string | null {
  const value = input.trim();
  if (!value) {
    return null;
  }
  const direct = new RegExp(`[?&#]${PAYLOAD_PARAM}=([^&\\s]+)`).exec(value);
  if (direct) {
    return decodeURIComponent(direct[1]!);
  }
  if (/^[A-Za-z0-9\-_]+$/.test(value) && value.length > 32) {
    return value;
  }
  try {
    const parsed = new URL(value, 'https://ikguide.local/');
    const g = parsed.searchParams.get(PAYLOAD_PARAM);
    return g ? g : null;
  } catch {
    return null;
  }
}

/**
 * Codes carried by a link, in the order the bridges introduced them:
 *   `?guideId=<code>` — the published-guide link (`…/?guideId=pay88sbx&api=http://192.168.1.50:8000`);
 *   `?guide=<id>`     — the stage-4 workshop link resolved against the offline library;
 *   `ikguide://guide/<id>` — the stage-1 deep link exported in the QR dialog.
 */
export function extractGuideId(input: string): string | null {
  const match = /^ikguide:\/\/guide\/([\w.:-]+)$/.exec(input.trim());
  if (match) {
    return match[1]!;
  }
  if (/^[\w.:-]{4,64}$/.test(input.trim())) {
    return input.trim();
  }
  try {
    const parsed = new URL(input.trim(), 'https://ikguide.local/');
    const fromQuery = parsed.searchParams.get('guideId') ?? parsed.searchParams.get('guide');
    if (fromQuery) {
      return fromQuery;
    }
    if (parsed.pathname.endsWith('/guide') || parsed.pathname.includes('/guide/')) {
      const last = parsed.pathname.split('/').filter(Boolean).pop();
      if (last && /^[\w.:-]+$/.test(last)) {
        return last;
      }
    }
  } catch {
    // Not a URL: nothing to extract.
  }
  return null;
}

/** Decodes a QR/manual payload back into a validated instruction. */
export function decodeGuidePayload(input: string): IkGuideDocument {
  const payload = extractPayload(input);
  if (!payload) {
    throw new Error('Это не ссылка IkGuide: в коде нет инструкции.');
  }
  let parsed: unknown;
  try {
    parsed = decompressDocument(base64UrlDecode(payload));
  } catch {
    throw new Error('Код повреждён или устарел: не удалось распаковать инструкцию.');
  }
  const validation = ikGuideDocumentSchema.safeParse(parsed);
  if (!validation.success) {
    const first = validation.error.issues[0];
    throw new Error(`Инструкция из QR не прошла проверку схемы${first ? `: ${first.message}` : '.'}`);
  }
  return validation.data;
}

/** «QR по цеховой ссылке»: an address of the local server + the guide id. */
export function buildWorkshopLink(baseUrl: string, guideId: string): string {
  const clean = baseUrl.trim().replace(/\/+$/, '');
  const safeId = encodeURIComponent(guideId.trim());
  if (!clean) {
    return `ikguide://guide/${safeId}`;
  }
  return `${clean}/?guide=${safeId}`;
}

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const escapeSvg = (value: string): string =>
  value.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*')/gi, '');

/**
 * A single self-contained `.html` file: no scripts, no network, inline styles, inline SVG diagrams.
 * Opens on any phone, tablet or PC — the last-resort way to hand an instruction to a workshop.
 */
export function buildStandaloneHtml(doc: IkGuideDocument, options: { generatedAt?: string } = {}): string {
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const steps = doc.steps
    .map((step) => {
      const svg = sanitizeSvgMarkup(step.svgDiagram);
      const art = svg
        ? `<div class="art">${escapeSvg(svg)}</div>`
        : '<div class="art art-empty">Схема шага — в приложении IkGuide</div>';
      const checks = step.criticalChecks.length
        ? `<table class="checks"><thead><tr><th>Контроль</th><th>Номинал</th><th>Критерий</th><th>Инструмент</th></tr></thead><tbody>${step.criticalChecks
            .map(
              (check) =>
                `<tr><td>${escapeHtml(check.label)}</td><td>${escapeHtml(check.nominal)}</td><td>${escapeHtml(
                  check.acceptance,
                )}</td><td>${escapeHtml(check.instrument)}</td></tr>`,
            )
            .join('')}</tbody></table>`
        : '';
      const anti = step.antiError
        ? `<div class="anti ${step.antiError.severity === 'critical' ? 'anti-critical' : ''}"><strong>${step.antiError.severity === 'critical' ? 'Нельзя' : 'Осторожно'}:</strong> ${escapeHtml(
            step.antiError.text,
          )}</div>`
        : '';
      return `<section class="step">
  <h2><span class="num">${step.number}</span> ${escapeHtml(step.title)}</h2>
  ${art}
  <p class="text">${escapeHtml(step.workerText)}</p>
  ${checks}
  ${anti}
</section>`;
    })
    .join('\n');

  const bom = doc.bom
    .map(
      (item) =>
        `<tr><td>${escapeHtml(item.name)}</td><td>${escapeHtml(item.size)}</td><td class="qty">×${item.quantity}</td><td>${escapeHtml(
          item.standard ?? '',
        )}</td></tr>`,
    )
    .join('');

  const tools = doc.tools
    .map(
      (tool) =>
        `<tr><td>${escapeHtml(tool.name)}${tool.size ? ` ${escapeHtml(tool.size)}` : ''}</td><td>${escapeHtml(
          tool.purpose,
        )}</td><td>${tool.forSteps.length ? `шаг ${tool.forSteps.join(', ')}` : '—'}</td></tr>`,
    )
    .join('');

  const qc = doc.qcChecklist
    .map((item) => `<li><span class="box"></span>${escapeHtml(item.text)}</li>`)
    .join('');

  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(doc.metadata.title)} — инструкция IkGuide</title>
<style>
  :root { color-scheme: light; --ink:#1D1D1F; --ink-2:#575D6C; --line:#E6E8EC; --accent:#007AFF; --danger:#FF3B30; --paper:#FFFFFF; --surface:#F7F8FA; }
  * { box-sizing: border-box; }
  body { margin:0; padding:24px; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif; color:var(--ink); background:var(--surface); }
  main { max-width: 860px; margin: 0 auto; }
  header { background:var(--paper); border:1px solid var(--line); border-radius:20px; padding:20px 24px; }
  h1 { margin:0 0 6px; font-size:26px; }
  .code { color:var(--ink-2); font-size:14px; }
  .facts { display:flex; flex-wrap:wrap; gap:16px; margin-top:14px; font-size:14px; color:var(--ink-2); }
  .facts b { color:var(--ink); }
  h2 { font-size:20px; margin:0 0 12px; display:flex; align-items:center; gap:10px; }
  .num { display:inline-flex; align-items:center; justify-content:center; width:32px; height:32px; border-radius:50%; background:var(--ink); color:#fff; font-size:15px; }
  section.step, section.card { background:var(--paper); border:1px solid var(--line); border-radius:20px; padding:20px 24px; margin-top:16px; page-break-inside:avoid; }
  .art { border:1px solid var(--line); border-radius:14px; padding:8px; }
  .art svg { display:block; width:100%; height:auto; }
  .art-empty { color:var(--ink-2); font-size:14px; text-align:center; padding:24px; }
  .text { font-size:17px; line-height:1.5; }
  table { width:100%; border-collapse:collapse; font-size:14px; margin-top:10px; }
  th, td { text-align:left; padding:8px 10px; border-bottom:1px solid var(--line); }
  th { color:var(--ink-2); font-weight:600; }
  .qty { font-weight:700; color:var(--accent); }
  .anti { margin-top:12px; padding:12px 14px; border-radius:12px; background:rgba(255,59,48,.08); color:var(--danger); font-size:15px; }
  .anti-critical { border:1px solid var(--danger); }
  ul.qc { list-style:none; padding:0; margin:0; }
  ul.qc li { display:flex; gap:10px; padding:8px 0; font-size:15px; }
  .box { flex:0 0 auto; width:18px; height:18px; border:2px solid var(--ink); border-radius:4px; }
  footer { color:var(--ink-2); font-size:12px; text-align:center; margin:24px 0 8px; }
  @media print { body { background:#fff; padding:0; } main { max-width:none; } section.step, section.card, header { border:0; border-radius:0; padding:0 0 16px; margin:0 0 16px; border-bottom:1px solid var(--line); } }
</style>
</head>
<body>
<main>
  <header>
    <h1>${escapeHtml(doc.metadata.title)}</h1>
    <div class="code">${escapeHtml(doc.metadata.drawingCode)} · ревизия ${escapeHtml(doc.metadata.revision)} · ${escapeHtml(
      doc.drawing.sheetFormat,
    )} · ${escapeHtml(doc.drawing.scale)}</div>
    <div class="facts">
      <span>Материал: <b>${escapeHtml(doc.metadata.material)}</b></span>
      <span>Заготовка: <b>${escapeHtml(doc.metadata.blankDimensions)}</b></span>
      ${doc.metadata.massKg ? `<span>Масса: <b>${doc.metadata.massKg} кг</b></span>` : ''}
      <span>Шагов: <b>${doc.steps.length}</b></span>
    </div>
  </header>
  <section class="card">
    <h2>Комплектация и крепёж</h2>
    <table><thead><tr><th>Наименование</th><th>Типоразмер</th><th>Кол-во</th><th>Стандарт</th></tr></thead><tbody>${bom}</tbody></table>
  </section>
  <section class="card">
    <h2>Инструмент</h2>
    <table><thead><tr><th>Инструмент</th><th>Назначение</th><th>Шаги</th></tr></thead><tbody>${tools}</tbody></table>
  </section>
  ${steps}
  <section class="card">
    <h2>Проверь перед сдачей</h2>
    <ul class="qc">${qc}</ul>
  </section>
  <footer>Автономный файл IkGuide · сформирован ${escapeHtml(generatedAt)} · ${escapeHtml(
    doc.metadata.author,
  )} · открывается без интернета и без приложения</footer>
</main>
</body>
</html>`;
}

/** `.ikguide.json` payload, ready to be downloaded or sent through a messenger. */
export function buildOfflinePackage(doc: IkGuideDocument): string {
  return serializeDocument(doc);
}
