import type { CadImportResponse, CadPartPayload, CadStepPayload } from './types';

const SVG = (label: string): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 720 520" role="img" aria-label="${label}">` +
  '<rect width="720" height="520" fill="#FFFFFF"/>' +
  '<polygon points="10,10 120,10 120,120" fill="#E8F2FF" stroke="#007AFF"/>' +
  '<polygon points="200,200 320,200 320,320" fill="#FFFFFF" stroke="#1D1D1F"/>' +
  '</svg>';

function part(
  index: number,
  name: string,
  role: CadPartPayload['role'],
  options: { notation?: string | null; volume?: number; bbox?: [number, number, number]; group?: string; node?: string } = {},
): CadPartPayload {
  const bbox = options.bbox ?? [40, 20, 40];
  return {
    id: `part-${index}`,
    name,
    nodeName: options.node ?? `node-${index}`,
    role,
    bbox: { min: [0, 0, 0], max: [bbox[0], bbox[1], bbox[2]], size: [bbox[0], bbox[1], bbox[2]] },
    volumeMm3: options.volume ?? 1000,
    centroid: [0, 0, 0],
    triangleCount: 12,
    explosionVector: [0, 1, 0],
    groupKey: options.group ?? `${name.toLowerCase()}|${options.notation ?? ''}`,
    notation: options.notation ?? null,
  };
}

function step(
  number: number,
  kind: CadStepPayload['kind'],
  title: string,
  partIds: string[],
  options: { notation?: string | null; attention?: string | null } = {},
): CadStepPayload {
  return {
    number,
    kind,
    title,
    workerText: title,
    partIds,
    count: partIds.length,
    explosionVector: [0, 1, 0],
    azimuth: kind === 'fastener' ? -30 : 35,
    elevation: kind === 'fastener' ? 34 : 26,
    fastenerKey: kind === 'fastener' ? `fastener-${number}` : null,
    notation: options.notation ?? null,
    attention: options.attention ?? null,
    svg: SVG(`Шаг ${number}`),
  };
}

/** A 12-part drive unit, shaped exactly like `POST /v1/cad/import` returns it. */
export function cadUnitResponse(): CadImportResponse {
  const parts: CadPartPayload[] = [
    part(1, 'Корпус', 'base', { volume: 204000, bbox: [120, 40, 80], node: 'korpus' }),
    part(2, 'Вал', 'part', { volume: 15708, bbox: [20, 50, 20], node: 'val' }),
    part(3, 'Фланец', 'part', { volume: 23040, bbox: [60, 10, 60], node: 'flanets' }),
    part(4, 'Крышка', 'part', { volume: 76800, bbox: [120, 8, 80], node: 'kryshka' }),
  ];
  for (let index = 0; index < 4; index += 1) {
    parts.push(
      part(5 + index, 'Болт М6x20', 'fastener', {
        notation: 'М6×20',
        volume: 559.3,
        bbox: [6, 20, 6],
        group: 'болт|М6×20|6,6,20',
        node: index === 0 ? 'bolt-m6x20' : `bolt-m6x20-${index + 1}`,
      }),
    );
  }
  for (let index = 0; index < 4; index += 1) {
    parts.push(
      part(9 + index, 'Шайба 6', 'fastener', {
        volume: 167.7,
        bbox: [12, 1.5, 12],
        group: 'шайба||1,5,12,12',
        node: index === 0 ? 'shayba-6' : `shayba-6-${index + 1}`,
      }),
    );
  }

  const steps: CadStepPayload[] = [
    step(1, 'base', 'Уложи корпус базой вверх', ['part-1']),
    step(2, 'cover', 'Установи фланец', ['part-3']),
    step(3, 'part', 'Установи вал', ['part-2']),
    step(4, 'cover', 'Установи крышку', ['part-4']),
    step(5, 'fastener', 'Надень 4 шайбы 6', ['part-9', 'part-10', 'part-11', 'part-12'], {
      attention: 'Шайба ставится под головку каждого болта — иначе крышка продавится.',
    }),
    step(6, 'fastener', 'Закрути 4 болта М6x20', ['part-5', 'part-6', 'part-7', 'part-8'], {
      notation: 'М6×20',
      attention: 'Затягивайте крест-накрест: сначала наживите все, потом тяните по диагонали.',
    }),
  ];

  return {
    schemaVersion: '1.0',
    sessionId: 'cad-fixture-1',
    assembly: {
      name: 'Узел привода УП-08',
      filename: 'up-08.glb',
      sourceFormat: 'glb',
      unitScale: 1,
      sizeMm: [120, 68, 80],
      massKg: 3.4,
    },
    parts,
    steps,
    overviewSvg: SVG('Узел привода УП-08'),
    glbDataUrl: 'data:model/gltf-binary;base64,Z2xURg==',
    warnings: ['Масса оценена по стали 7,85 г/см³ — уточните материал в штампе или спецификации.'],
    stats: { parts: parts.length, fasteners: 8, steps: steps.length, triangles: 12 * parts.length },
  };
}

/** Adds a bushing, drops the flange and grows a bolt — a realistic revision of the model. */
export function cadUnitRevision(): CadImportResponse {
  const base = cadUnitResponse();
  const parts = base.parts
    .filter((item) => item.nodeName !== 'flanets')
    .map((item) =>
      item.nodeName === 'bolt-m6x20'
        ? { ...item, volumeMm3: item.volumeMm3 * 1.2, displayName: 'Болт М6x20' }
        : item,
    );
  const bushing = part(13, 'Втулка', 'part', { volume: 4200, bbox: [30, 20, 30], node: 'vtulka' });
  parts.splice(3, 0, bushing);

  const steps: CadStepPayload[] = [
    step(1, 'base', 'Уложи корпус базой вверх', ['part-1']),
    step(2, 'part', 'Установи втулку', ['part-13']),
    step(3, 'part', 'Установи вал', ['part-2']),
    step(4, 'cover', 'Установи крышку', ['part-4']),
    step(5, 'fastener', 'Надень 4 шайбы 6', ['part-9', 'part-10', 'part-11', 'part-12'], {
      attention: 'Шайба ставится под головку каждого болта — иначе крышка продавится.',
    }),
    step(6, 'fastener', 'Закрути 4 болта М6x20', ['part-5', 'part-6', 'part-7', 'part-8'], {
      notation: 'М6×20',
      attention: 'Затягивайте крест-накрест: сначала наживите все, потом тяните по диагонали.',
    }),
  ];

  return {
    ...base,
    sessionId: 'cad-fixture-2',
    parts,
    steps,
    stats: { ...base.stats!, parts: parts.length },
  };
}
