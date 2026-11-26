import QRCode from 'qrcode';
import jsQR from 'jsqr';
import { describe, expect, it } from 'vitest';
import { ikGuideDocumentSchema, parseDocument } from '@ikguide/schema';
import { bracketDocument, gearboxDocument } from '../data/demos';
import { up08Document } from './demo3d';
import {
  DROP_WARNINGS,
  PAYLOAD_PARAM,
  QR_MAX_BYTES,
  buildOfflinePackage,
  buildStandaloneHtml,
  buildWorkshopLink,
  decodeGuidePayload,
  encodeGuidePayload,
  extractGuideId,
  extractPayload,
  qrVariants,
} from './qrBridge';

/** A deliberately short instruction — the kind that really does fit a QR code. */
function shortGuide() {
  return parseDocument({
    ...JSON.parse(buildOfflinePackage(bracketDocument)),
    id: 'guide-short-01',
    metadata: { ...bracketDocument.metadata, title: 'Косынка КС-04', drawingCode: 'КС-04-01' },
    steps: bracketDocument.steps.slice(0, 1).map((step) => ({
      ...step,
      id: 'step-1',
      number: 1,
      title: 'Разметьте базу А',
      workerText: 'Положите полосу на плиту и отметьте длинную кромку как базу А.',
      drawingRefs: [],
      estimatedMinutes: 5,
      criticalChecks: step.criticalChecks.slice(0, 1),
      antiError: null,
    })),
    xrayAnnotations: [],
    qcChecklist: bracketDocument.qcChecklist.slice(0, 1),
    bom: bracketDocument.bom.slice(0, 1),
    tools: bracketDocument.tools.slice(0, 1).map((tool) => ({ ...tool, forSteps: [1] })),
  });
}

describe('QR payload', () => {
  it('packs a short instruction into a QR-sized link and unpacks it back', () => {
    const doc = shortGuide();
    const result = encodeGuidePayload(doc, { baseUrl: 'http://192.168.1.50:5173' });
    expect(result.tooLarge).toBe(false);
    expect(result.bytes).toBeLessThanOrEqual(QR_MAX_BYTES);
    expect(result.dropped).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.strippedGlb).toBe(false);
    expect(result.url.startsWith(`http://192.168.1.50:5173/?${PAYLOAD_PARAM}=`)).toBe(true);

    const decoded = decodeGuidePayload(result.url);
    expect(decoded.id).toBe(doc.id);
    expect(decoded.steps).toHaveLength(1);
    expect(decoded.steps[0]!.workerText).toBe(doc.steps[0]!.workerText);
    expect(decoded.bom[0]!.standard).toBe(doc.bom[0]!.standard);
    expect(decoded.tools[0]!.name).toBe(doc.tools[0]!.name);
  });

  it('drops the 3D file when a 3D assembly does not fit, and says so honestly', () => {
    const doc = up08Document();
    const result = encodeGuidePayload(doc);
    expect(result.strippedGlb).toBe(true);
    expect(result.dropped[0]).toBe('glb');
    expect(result.warnings[0]).toBe(DROP_WARNINGS.glb);
    expect(result.warnings[0]).toContain('В QR упакованы все шаги, инструмент, ГОСТ-переводы и SVG-схемы');

    const decoded = decodeGuidePayload(result.payload);
    expect(decoded.id).toBe(doc.id);
    expect(decoded.steps.map((step) => step.workerText)).toEqual(doc.steps.map((step) => step.workerText));
    expect(decoded.bom).toHaveLength(doc.bom.length);
    expect(decoded.tools).toHaveLength(doc.tools.length);
    expect(decoded.qcChecklist).toHaveLength(doc.qcChecklist.length);
    expect(decoded.assembly3d?.glbDataUrl ?? '').toBe('');
  });

  it('keeps instructions readable when a long guide does not fit any code', () => {
    const result = encodeGuidePayload(bracketDocument);
    expect(result.tooLarge).toBe(true);
    expect(result.suggestion).toBe('link');
    expect(result.dropped).toContain('diagrams');
    expect(result.warnings).toContain(DROP_WARNINGS.diagrams);
    // A too-large payload is still a working link — a big code beats a broken one.
    const decoded = decodeGuidePayload(result.payload);
    expect(decoded.steps).toHaveLength(bracketDocument.steps.length);
    expect(decoded.steps[0]!.criticalChecks).toEqual(bracketDocument.steps[0]!.criticalChecks);
  });

  it('never produces a variant that breaks the schema', () => {
    for (const doc of [bracketDocument, gearboxDocument, up08Document()]) {
      let count = 0;
      for (const variant of qrVariants(doc)) {
        expect(ikGuideDocumentSchema.safeParse(variant.doc).success).toBe(true);
        expect(variant.doc.steps.length).toBe(doc.steps.length);
        count += 1;
      }
      expect(count).toBeGreaterThan(0);
    }
  });

  it('refuses to pack a document that does not match the schema', () => {
    const broken = { ...bracketDocument, steps: [] } as unknown as typeof bracketDocument;
    expect(() => encodeGuidePayload(broken)).toThrow(/схем/);
  });

  it('reads the payload out of links, hash routes and bare codes', () => {
    const result = encodeGuidePayload(shortGuide());
    expect(extractPayload(`https://shop.local/?${PAYLOAD_PARAM}=${result.payload}`)).toBe(result.payload);
    expect(extractPayload(`https://shop.local/#/?${PAYLOAD_PARAM}=${result.payload}&x=1`)).toBe(result.payload);
    expect(extractPayload(result.payload)).toBe(result.payload);
    expect(extractPayload('просто текст')).toBeNull();
    expect(extractPayload('')).toBeNull();
  });

  it('explains a broken or foreign code in Russian', () => {
    expect(() => decodeGuidePayload('https://example.com/')).toThrow(/не ссылка IkGuide/);
    expect(() => decodeGuidePayload('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA')).toThrow(/повреждён|проверку/);
  });
});

interface QrMatrix {
  size: number;
  get: (row: number, column: number) => number;
}

/** Rasterises QR modules into RGBA, so a real decoder can read them back (no canvas needed). */
function renderQr(text: string): { data: Uint8ClampedArray; width: number } {
  const create = (QRCode as unknown as { create: (value: string, options: { errorCorrectionLevel: 'L' }) => { modules: QrMatrix } })
    .create;
  const { modules } = create(text, { errorCorrectionLevel: 'L' });
  const scale = 4;
  const quiet = 4;
  const width = (modules.size + quiet * 2) * scale;
  const data = new Uint8ClampedArray(width * width * 4).fill(255);
  for (let row = 0; row < modules.size; row += 1) {
    for (let column = 0; column < modules.size; column += 1) {
      if (!modules.get(row, column)) {
        continue;
      }
      for (let y = 0; y < scale; y += 1) {
        for (let x = 0; x < scale; x += 1) {
          const px = ((quiet + column) * scale + x) * 4;
          const py = ((quiet + row) * scale + y) * 4;
          const offset = py * width + px;
          data[offset] = 0;
          data[offset + 1] = 0;
          data[offset + 2] = 0;
          data[offset + 3] = 255;
        }
      }
    }
  }
  return { data, width };
}

describe('scannable code', () => {
  it('survives a real QR round trip: modules → jsQR → unpacked instruction', () => {
    const doc = shortGuide();
    const encoded = encodeGuidePayload(doc, { baseUrl: 'http://192.168.1.50:5173' });
    const { data, width } = renderQr(encoded.url);
    const scanned = jsQR(data, width, width, { inversionAttempts: 'attemptBoth' });
    expect(scanned?.data).toBe(encoded.url);

    const restored = decodeGuidePayload(scanned!.data);
    expect(restored.id).toBe(doc.id);
    expect(restored.steps[0]!.workerText).toBe(doc.steps[0]!.workerText);
  });

  it('keeps the workshop link short enough for any scanner', () => {
    const link = buildWorkshopLink('http://192.168.1.50:5173', up08Document().id);
    expect(link.length).toBeLessThan(120);
    const { data, width } = renderQr(link);
    const scanned = jsQR(data, width, width, { inversionAttempts: 'attemptBoth' });
    expect(scanned?.data).toBe(link);
  });
});

describe('workshop link', () => {
  it('builds a link to a guide on the local server and reads the id back', () => {
    const link = buildWorkshopLink('http://192.168.1.50:5173/', up08Document().id);
    expect(link).toBe(`http://192.168.1.50:5173/?guide=${encodeURIComponent(up08Document().id)}`);
    expect(extractGuideId(link)).toBe(up08Document().id);
    expect(extractGuideId(`ikguide://guide/${up08Document().id}`)).toBe(up08Document().id);
    expect(extractGuideId('https://example.com/foo')).toBeNull();
  });

  it('falls back to the app deep link when no server address is set', () => {
    expect(buildWorkshopLink('', bracketDocument.id)).toBe(`ikguide://guide/${encodeURIComponent(bracketDocument.id)}`);
  });
});

describe('offline package and standalone HTML', () => {
  it('serialises a package that parses back into the same instruction', () => {
    const text = buildOfflinePackage(gearboxDocument);
    const reparsed = parseDocument(JSON.parse(text));
    expect(reparsed.id).toBe(gearboxDocument.id);
    expect(reparsed.steps).toHaveLength(gearboxDocument.steps.length);
  });

  it('builds one self-contained HTML file without scripts or network', () => {
    const doc = up08Document();
    const html = buildStandaloneHtml(doc, { generatedAt: '2026-11-26T09:00:00.000Z' });
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('<meta charset="utf-8">');
    expect(html).toContain(doc.metadata.title);
    expect(html.split('<svg').length - 1).toBeGreaterThanOrEqual(doc.steps.length);
    expect(html).not.toContain('<script');
    expect(html).not.toContain('<link');
    expect(html).not.toContain('src=');
    expect(html).not.toContain('@import');
    expect(html).not.toContain('<img');
    expect(html).toContain('2026-11-26T09:00:00.000Z');
    for (const step of doc.steps) {
      expect(html).toContain(step.workerText.slice(0, 40));
    }
    expect(html).toContain('Проверь перед сдачей');
    expect(html).toContain(doc.tools[0]!.name);
    expect(html).toContain(doc.qcChecklist[0]!.text);
  });

  it('prints warnings and a placeholder when a step has no diagram', () => {
    const html = buildStandaloneHtml(bracketDocument);
    expect(html).toContain('Схема шага — в приложении IkGuide');
    const anti = bracketDocument.steps.find((step) => step.antiError);
    expect(anti).toBeTruthy();
    expect(html).toContain(anti!.antiError!.text);
  });

  it('escapes text from the drawing instead of executing it', () => {
    const hostile = parseDocument({
      ...JSON.parse(buildOfflinePackage(bracketDocument)),
      metadata: { ...bracketDocument.metadata, title: '<script>alert(1)</script>' },
    });
    const html = buildStandaloneHtml(hostile);
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });
});
