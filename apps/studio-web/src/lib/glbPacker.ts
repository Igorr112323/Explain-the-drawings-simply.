import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { CadImportResponse, CadPartPayload, CadStepPayload } from '@ikguide/builder';
import { renderIkeaSvg, type IkeaPartInput } from './ikeaSvg';
import { humanize, roleOf, shapeNotation } from './partNaming';

/**
 * Упаковщик GLB: three.js разбирает модель прямо в браузере и делает черновик ответа cad-api.
 *
 * Модуль тяжёлый (three.js), поэтому его импортируют динамически только тогда, когда человек
 * действительно перетащил `.glb`: главный экран студии остаётся лёгким.
 *
 * Черновик честен про ограничения: нет реальных объёмов, контактного графа и симуляции разборки —
 * только имена узлов, габариты и порядок по размеру.
 */

interface RawPart {
  name: string;
  box: THREE.Box3;
}

function collectParts(root: THREE.Object3D): RawPart[] {
  const parts: RawPart[] = [];
  root.updateMatrixWorld(true);
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry) {
      return;
    }
    const holder = mesh.parent && mesh.parent !== root ? mesh.parent : mesh;
    const name = holder.name || mesh.name || 'Деталь';
    mesh.geometry.computeBoundingBox();
    const box = new THREE.Box3().setFromObject(mesh);
    parts.push({ name, box });
  });
  return parts;
}

/** Groups meshes that belong to one named node into a single part. */
function mergeByName(raw: RawPart[]): RawPart[] {
  const merged = new Map<string, RawPart>();
  for (const part of raw) {
    const existing = merged.get(part.name);
    if (existing) {
      existing.box.union(part.box);
    } else {
      merged.set(part.name, { name: part.name, box: part.box.clone() });
    }
  }
  return [...merged.values()];
}

function dataUrlToBuffer(dataUrl: string): ArrayBuffer {
  const comma = dataUrl.indexOf(',');
  const payload = dataUrl.slice(comma + 1);
  const binary = globalThis.atob(payload);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes.buffer;
}

export class GlbReadError extends Error {}

/** Разбирает GLB/GLTF data URL и отдаёт черновик ответа сервиса 3D. */
export async function packGlb(dataUrl: string, fileName: string): Promise<CadImportResponse> {
  const extension = fileName.slice(fileName.lastIndexOf('.')).toLowerCase();
  const buffer = dataUrlToBuffer(dataUrl);
  const corrupt = () => new GlbReadError('Файл GLB повреждён: не удалось прочитать геометрию.');
  const gltf = await new Promise<{ scene: THREE.Group }>((resolve, reject) => {
    try {
      new GLTFLoader().parse(
        buffer,
        '',
        (result) => resolve(result as unknown as { scene: THREE.Group }),
        () => reject(corrupt()),
      );
    } catch {
      // GLTFLoader also throws synchronously on a broken header — keep the message human.
      reject(corrupt());
    }
  });

  const merged = mergeByName(collectParts(gltf.scene));
  if (merged.length === 0) {
    throw new GlbReadError('В модели не нашлось ни одной детали.');
  }

  const assemblyBox = merged.reduce((box, part) => box.union(part.box), new THREE.Box3());
  const assemblyCenter = assemblyBox.getCenter(new THREE.Vector3());
  const size = assemblyBox.getSize(new THREE.Vector3());

  const measured = merged.map((part) => {
    const partSize = part.box.getSize(new THREE.Vector3());
    const center = part.box.getCenter(new THREE.Vector3());
    const volume = Math.max(1, partSize.x * partSize.y * partSize.z);
    return { ...part, partSize, center, volume };
  });
  const biggest = Math.max(...measured.map((part) => part.volume));

  const ids = new Map<string, string>();
  measured.forEach((part, index) => ids.set(part.name, `part-${index + 1}`));

  const parts: CadPartPayload[] = measured.map((part) => {
    const direction = part.center.clone().sub(assemblyCenter);
    if (direction.lengthSq() < 1e-6) {
      direction.set(0, 1, 0);
    }
    direction.normalize();
    return {
      id: ids.get(part.name)!,
      name: humanize(part.name),
      nodeName: part.name,
      role: roleOf(part.name, part.volume, biggest),
      bbox: {
        min: [part.box.min.x, part.box.min.y, part.box.min.z],
        max: [part.box.max.x, part.box.max.y, part.box.max.z],
        size: [part.partSize.x, part.partSize.y, part.partSize.z],
      },
      volumeMm3: Math.round(part.volume * 0.55),
      centroid: [part.center.x, part.center.y, part.center.z],
      triangleCount: 0,
      explosionVector: [direction.x, direction.y, direction.z],
      groupKey: `${roleOf(part.name, part.volume, biggest)}:${humanize(part.name)}`,
      notation: shapeNotation(part.name),
    };
  });

  // Order: base (the largest part) first, then by volume, fasteners last, identical ones grouped.
  const ordered = [...measured].sort((a, b) => {
    const rank = (part: (typeof measured)[number]) =>
      roleOf(part.name, part.volume, biggest) === 'fastener' ? 1 : 0;
    const byRole = rank(a) - rank(b);
    if (byRole !== 0) {
      return byRole;
    }
    return roleOf(a.name, a.volume, biggest) === 'fastener'
      ? humanize(a.name).localeCompare(humanize(b.name), 'ru')
      : b.volume - a.volume;
  });

  const grouped = new Map<string, typeof ordered>();
  for (const part of ordered) {
    const key = humanize(part.name);
    const bucket = grouped.get(key);
    if (bucket) {
      bucket.push(part);
    } else {
      grouped.set(key, [part]);
    }
  }

  const sceneParts: IkeaPartInput[] = parts.map((part) => ({
    id: part.id,
    center: part.centroid,
    size: part.bbox?.size ?? [10, 10, 10],
    explosionVector: part.explosionVector,
    role: part.role,
    displayName: part.name,
  }));

  const buckets = [...grouped.values()];
  const steps: CadStepPayload[] = [];
  const installedSoFar: string[] = [];
  let number = 0;
  for (const bucket of buckets) {
    number += 1;
    const groupIds = bucket.map((part) => ids.get(part.name)!);
    const active = bucket[0]!;
    const activePayload = parts.find((part) => part.id === ids.get(active.name));
    const laterIds = buckets
      .slice(number)
      .flatMap((later) => later.map((part) => ids.get(part.name)!));
    const role = roleOf(active.name, active.volume, biggest);
    const isFastener = role === 'fastener';
    const displayName = humanize(active.name);
    const title =
      groupIds.length > 1
        ? `${isFastener ? 'Установи' : 'Поставь'} ${groupIds.length} × ${displayName}`
        : `${isFastener ? 'Установи' : 'Поставь'} ${displayName}`;
    const azimuth = 32 + (number % 4) * 9;
    const elevation = 24 + (number % 3) * 6;
    const hidden = laterIds.filter((id) => !groupIds.includes(id) && !installedSoFar.includes(id));

    steps.push({
      number,
      kind: isFastener ? 'fastener' : number === 1 ? 'base' : 'part',
      title,
      workerText: '',
      partIds: groupIds,
      count: groupIds.length,
      explosionVector: activePayload?.explosionVector ?? [0, 1, 0],
      azimuth,
      elevation,
      fastenerKey: isFastener ? displayName : null,
      notation: shapeNotation(active.name),
      attention: null,
      svg: renderIkeaSvg(
        { parts: sceneParts, diagonal: Math.max(1, size.length()) },
        {
          activePartIds: groupIds,
          installedPartIds: [...installedSoFar],
          hiddenPartIds: hidden,
          azimuth,
          elevation,
          caption: `Шаг ${number}. ${title}`,
        },
      ),
    });
    installedSoFar.push(...groupIds);
  }

  return {
    schemaVersion: '1.0',
    sessionId: `offline-${Date.now()}`,
    assembly: {
      name: humanize(fileName.replace(/\.[^.]+$/, '')),
      filename: fileName,
      sourceFormat: extension.replace('.', ''),
      sizeMm: [size.x, size.y, size.z],
    },
    parts,
    steps,
    glbDataUrl: dataUrl,
    warnings: [
      'Модель разобрана в браузере без сервера: объёмы и порядок сборки оценены по габаритам. Проверьте шаги перед выдачей в цех.',
    ],
    stats: {
      parts: parts.length,
      fasteners: parts.filter((part) => part.role === 'fastener').length,
      steps: steps.length,
      triangles: 0,
    },
  };
}
