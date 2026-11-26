import type { AssemblyPart } from '@ikguide/schema';
import type { CadImportResponse } from '@ikguide/builder';

/**
 * Client-side IKEA SVG renderer — the offline twin of `services/cad-api/app/ikea_svg.py`.
 *
 * It draws every part as an isometric AABB silhouette: six faces, painter-sorted, exactly the same
 * four semantic colours as the server (paper white, installed grey, ink black, active blue) plus
 * the red attention accent. Quality is coarser than the server renderer (which extracts real
 * silhouette edges from the triangles), but it needs no network and no WebGL, so a step diagram can
 * always be produced: on the shop-floor tablet with the CAD service stopped, and inside the packaged
 * the packaged Tauri shell.
 *
 * SVG only — never a raster screenshot — so the drawing stays crisp on A4 and inside the print sheet.
 */

export const IKEA_PALETTE = {
  paper: '#FFFFFF',
  installed: '#F2F4F7',
  ink: '#1D1D1F',
  activeFill: '#E8F2FF',
  activeLine: '#007AFF',
  attention: '#FF3B30',
} as const;

const VIEW_WIDTH = 720;
const VIEW_HEIGHT = 520;
const PADDING = 46;
const CAPTION_HEIGHT = 38;
const EXPLODE_SHARE = 0.45;

export interface IkeaPartInput {
  id: string;
  /** Bounding box centre in millimetres (Y-up, as the cad-api normalises it). */
  center: [number, number, number];
  /** Bounding box size in millimetres. */
  size: [number, number, number];
  explosionVector: [number, number, number];
  role: 'base' | 'part' | 'fastener';
  displayName?: string;
}

export interface IkeaSceneInput {
  activePartIds?: string[];
  installedPartIds?: string[];
  /** Parts that already exist but are not installed yet: outline only. */
  ghostPartIds?: string[];
  /** Parts that must stay invisible (not yet reached by the instruction). */
  hiddenPartIds?: string[];
  azimuth?: number;
  elevation?: number;
  /** 0 = assembled, 1 = fully exploded. */
  explode?: number;
  attention?: string | null;
  caption?: string | null;
}

type Vec3 = [number, number, number];

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const norm = (a: Vec3): Vec3 => {
  const length = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / length, a[1] / length, a[2] / length];
};

interface Camera {
  right: Vec3;
  up: Vec3;
  forward: Vec3;
}

function cameraFor(azimuth: number, elevation: number): Camera {
  const az = (azimuth * Math.PI) / 180;
  const el = (Math.max(-88, Math.min(88, elevation)) * Math.PI) / 180;
  // Camera sits on this direction, looking at the origin.
  const eye = norm([Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)]);
  const forward = scale(eye, -1);
  const right = norm(cross(forward, [0, 1, 0]));
  const up = cross(right, forward);
  return { right, up, forward };
}

interface Face {
  points: Vec3[];
  normal: Vec3;
  depth: number;
  fill: string;
  stroke: string;
  strokeWidth: number;
  dashed: boolean;
  partId: string;
}

const BOX_FACES: number[][] = [
  // Corner order: index = (x>=0 ? 4 : 0) + (y>=0 ? 2 : 0) + (z>=0 ? 1 : 0).
  [0, 1, 3, 2], // x = -
  [4, 6, 7, 5], // x = +
  [0, 2, 6, 4], // y = -
  [1, 5, 7, 3], // y = +
  [0, 4, 6, 2], // z = -
  [1, 3, 7, 5], // z = +
];

function boxCorners(center: Vec3, size: Vec3): Vec3[] {
  const half: Vec3 = [size[0] / 2, size[1] / 2, size[2] / 2];
  const corners: Vec3[] = [];
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      for (const sz of [-1, 1]) {
        corners.push([
          center[0] + half[0] * sx,
          center[1] + half[1] * sy,
          center[2] + half[2] * sz,
        ]);
      }
    }
  }
  return corners;
}

function faceNormal(points: Vec3[]): Vec3 {
  const [a, b, c] = points;
  if (!a || !b || !c) {
    return [0, 1, 0];
  }
  return norm(cross(sub(b, a), sub(c, a)));
}

const round = (value: number): number => Math.round(value * 10) / 10;

const escapeXml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

export interface IkeaSceneGeometry {
  parts: IkeaPartInput[];
  /** Diagonal of the whole assembly, used to scale the explosion offset. */
  diagonal: number;
}

export function sceneFromCadResponse(response: CadImportResponse): IkeaSceneGeometry {
  const parts: IkeaPartInput[] = response.parts.map((part) => ({
    id: part.id,
    center: part.centroid,
    size: part.bbox?.size ?? [10, 10, 10],
    explosionVector: part.explosionVector,
    role: part.role,
    displayName: part.displayName ?? part.name,
  }));
  return { parts, diagonal: diagonalOf(parts) };
}

export function sceneFromParts(
  parts: readonly (AssemblyPart & { center?: [number, number, number] })[],
  centers?: Readonly<Record<string, [number, number, number]>>,
): IkeaSceneGeometry {
  const converted: IkeaPartInput[] = parts.map((part) => {
    const size: Vec3 = part.bboxMm ? [part.bboxMm.x, part.bboxMm.y, part.bboxMm.z] : [10, 10, 10];
    const center = part.center ?? centers?.[part.id] ?? [0, 0, 0];
    return {
      id: part.id,
      center,
      size,
      explosionVector: part.explosionVector,
      role: part.role,
      displayName: part.displayName,
    };
  });
  return { parts: converted, diagonal: diagonalOf(converted) };
}

function diagonalOf(parts: IkeaPartInput[]): number {
  if (parts.length === 0) {
    return 100;
  }
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const part of parts) {
    for (let axis = 0; axis < 3; axis += 1) {
      const half = (part.size[axis] ?? 0) / 2;
      min[axis] = Math.min(min[axis]!, (part.center[axis] ?? 0) - half);
      max[axis] = Math.max(max[axis]!, (part.center[axis] ?? 0) + half);
    }
  }
  const span: Vec3 = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
  return Math.max(1, Math.hypot(span[0], span[1], span[2]));
}

/**
 * Renders one assembly step as a standalone SVG string.
 * The output is deterministic, so the same inputs always give byte-identical markup.
 */
export function renderIkeaSvg(scene: IkeaSceneGeometry, step: IkeaSceneInput): string {
  const azimuth = step.azimuth ?? 35;
  const elevation = step.elevation ?? 26;
  const explode = Math.max(0, Math.min(1, step.explode ?? 0.55));
  const camera = cameraFor(azimuth, elevation);

  const active = new Set(step.activePartIds ?? []);
  const installed = new Set(step.installedPartIds ?? []);
  const ghost = new Set(step.ghostPartIds ?? []);
  const hidden = new Set(step.hiddenPartIds ?? []);

  const explodeDistance = scene.diagonal * EXPLODE_SHARE * explode;
  // Faces are painted part by part: a compact solid sorts more reliably than loose faces.
  const partLayers: { partId: string; isActive: boolean; depth: number; faces: Face[] }[] = [];
  const axisLines: { from: Vec3; to: Vec3 }[] = [];

  for (const part of scene.parts) {
    if (hidden.has(part.id)) {
      continue;
    }
    const isActive = active.has(part.id);
    // Anything visible but not installed yet is a ghost outline: that is how IKEA shows «what comes next».
    const isGhost = !isActive && !hidden.has(part.id) && (ghost.has(part.id) || !installed.has(part.id));
    const offset = isActive || isGhost
      ? scale(norm(part.explosionVector), isActive ? explodeDistance : explodeDistance * 0.75)
      : ([0, 0, 0] as Vec3);
    const center = add(part.center, offset);
    const corners = boxCorners(center, part.size);
    const layer: { partId: string; isActive: boolean; depth: number; faces: Face[] } = {
      partId: part.id,
      isActive,
      depth: dot(center, camera.forward),
      faces: [],
    };
    const fill = isActive ? IKEA_PALETTE.activeFill : IKEA_PALETTE.paper;
    const sideFill = isActive ? IKEA_PALETTE.activeFill : IKEA_PALETTE.installed;
    const stroke = isActive ? IKEA_PALETTE.activeLine : IKEA_PALETTE.ink;
    const strokeWidth = isActive ? 2.2 : 1.5;

    for (const indices of BOX_FACES) {
      const points = indices.map((index) => corners[index]!);
      const normal = faceNormal(points);
      // Backface culling: a face is visible when it points towards the camera.
      if (dot(normal, camera.forward) >= -0.02) {
        continue;
      }
      // Painter's order uses the farthest corner: a face that reaches further away has to be
      // painted first, otherwise long parts (flange bars) cut through the housing walls.
      const farthest = points.reduce((acc, point) => Math.max(acc, dot(point, camera.forward)), -Infinity);
      const lit = Math.abs(normal[1]) > 0.6;
      layer.faces.push({
        points,
        normal,
        depth: farthest,
        fill: lit ? fill : sideFill,
        stroke: isGhost ? IKEA_PALETTE.ink : stroke,
        strokeWidth: isGhost ? 1 : strokeWidth,
        dashed: isGhost,
      partId: part.id,
      });
    }

    layer.faces.sort((a, b) => b.depth - a.depth);
    partLayers.push(layer);

    if (isActive) {
      axisLines.push({ from: part.center, to: center });
    }
  }

  // Painter's algorithm over parts (farthest first); the highlighted parts always stay on top so the
  // blue arrow is never hidden behind an already installed base.
  partLayers.sort((a, b) => Number(a.isActive) - Number(b.isActive) || b.depth - a.depth);
  const faces: Face[] = partLayers.flatMap((layer) => layer.faces);

  const project = (point: Vec3): [number, number] => [dot(point, camera.right), -dot(point, camera.up)];

  const allPoints: [number, number][] = [];
  for (const face of faces) {
    for (const point of face.points) {
      allPoints.push(project(point));
    }
  }
  for (const line of axisLines) {
    allPoints.push(project(line.to));
  }

  const available = {
    width: VIEW_WIDTH - PADDING * 2,
    height: VIEW_HEIGHT - PADDING * 2 - CAPTION_HEIGHT,
  };
  let minX = -1;
  let maxX = 1;
  let minY = -1;
  let maxY = 1;
  if (allPoints.length > 0) {
    minX = Math.min(...allPoints.map((point) => point[0]));
    maxX = Math.max(...allPoints.map((point) => point[0]));
    minY = Math.min(...allPoints.map((point) => point[1]));
    maxY = Math.max(...allPoints.map((point) => point[1]));
  }
  const spanX = Math.max(1, maxX - minX);
  const spanY = Math.max(1, maxY - minY);
  const zoom = Math.min(available.width / spanX, available.height / spanY);
  const shiftX = PADDING + (available.width - spanX * zoom) / 2 - minX * zoom;
  const shiftY = PADDING + (available.height - spanY * zoom) / 2 - minY * zoom;

  const toScreen = (point: Vec3): [number, number] => {
    const [x, y] = project(point);
    return [round(x * zoom + shiftX), round(y * zoom + shiftY)];
  };

  const body: string[] = [];
  for (const face of faces) {
    const polygon = face.points.map((point) => toScreen(point).join(',')).join(' ');
    const dash = face.dashed ? ' stroke-dasharray="5 5"' : '';
    body.push(
      `<polygon points="${polygon}" fill="${face.fill}" stroke="${face.stroke}" ` +
        `stroke-width="${face.strokeWidth}" stroke-linejoin="round"${dash} data-part="${escapeXml(face.partId)}"/>`,
    );
  }

  // Dashed assembly axis + bold blue arrow for every active part.
  for (const line of axisLines) {
    const [x1, y1] = toScreen(line.from);
    const [x2, y2] = toScreen(line.to);
    const dx = x2 - x1;
    const dy = y2 - y1;
    const length = Math.hypot(dx, dy);
    if (length < 6) {
      continue;
    }
    const ux = dx / length;
    const uy = dy / length;
    const head = Math.min(20, Math.max(12, length * 0.32));
    const tipX = x2 + ux * head;
    const tipY = y2 + uy * head;
    body.push(
      `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${IKEA_PALETTE.ink}" ` +
        `stroke-width="1.4" stroke-dasharray="7 6" class="assembly-axis"/>`,
    );
    body.push(
      `<line x1="${x1}" y1="${y1}" x2="${round(tipX)}" y2="${round(tipY)}" ` +
        `stroke="${IKEA_PALETTE.activeLine}" stroke-width="3.4" stroke-linecap="round" class="install-arrow"/>`,
    );
    const leftX = round(tipX - ux * head * 0.8 - uy * head * 0.42);
    const leftY = round(tipY - uy * head * 0.8 + ux * head * 0.42);
    const rightX = round(tipX - ux * head * 0.8 + uy * head * 0.42);
    const rightY = round(tipY - uy * head * 0.8 - ux * head * 0.42);
    body.push(
      `<polygon points="${round(tipX)},${round(tipY)} ${leftX},${leftY} ${rightX},${rightY}" ` +
        `fill="${IKEA_PALETTE.activeLine}" class="install-arrow"/>`,
    );
  }

  if (step.attention) {
    body.push(
      `<g class="attention">` +
        `<circle cx="${VIEW_WIDTH - 54}" cy="54" r="18" fill="${IKEA_PALETTE.paper}" ` +
        `stroke="${IKEA_PALETTE.attention}" stroke-width="2.4"/>` +
        `<text x="${VIEW_WIDTH - 54}" y="61" text-anchor="middle" font-size="22" ` +
        `font-family="'Helvetica Neue',Arial,sans-serif" font-weight="700" ` +
        `fill="${IKEA_PALETTE.attention}">!</text>` +
        `</g>`,
    );
  }

  if (step.caption) {
    body.push(
      `<text x="${PADDING}" y="${VIEW_HEIGHT - 18}" font-size="20" ` +
        `font-family="'Helvetica Neue',Arial,sans-serif" fill="${IKEA_PALETTE.ink}" class="caption">` +
        `${escapeXml(step.caption)}</text>`,
    );
  }

  if (faces.length === 0) {
    body.push(
      `<text x="${VIEW_WIDTH / 2}" y="${VIEW_HEIGHT / 2}" text-anchor="middle" font-size="22" ` +
        `font-family="'Helvetica Neue',Arial,sans-serif" fill="${IKEA_PALETTE.ink}">Нет геометрии</text>`,
    );
  }

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}" ` +
    `width="${VIEW_WIDTH}" height="${VIEW_HEIGHT}" role="img" ` +
    `data-azimuth="${round(azimuth)}" data-elevation="${round(elevation)}" ` +
    `data-renderer="ikea-svg-ts">` +
    `<rect width="${VIEW_WIDTH}" height="${VIEW_HEIGHT}" fill="${IKEA_PALETTE.paper}"/>` +
    `<g class="parts">${body.join('')}</g>` +
    `</svg>`
  );
}

/**
 * Convenience wrapper used by the studio: renders a step diagram and never throws.
 * If anything goes wrong (broken geometry, empty assembly) a placeholder SVG with the palette is
 * returned, so a step always shows *something* printable.
 */
export function safeRenderIkeaSvg(scene: IkeaSceneGeometry | null, step: IkeaSceneInput): string {
  if (!scene || scene.parts.length === 0) {
    return renderIkeaSvg({ parts: [], diagonal: 100 }, { ...step, attention: step.attention ?? null });
  }
  try {
    return renderIkeaSvg(scene, step);
  } catch {
    return renderIkeaSvg({ parts: [], diagonal: 100 }, { ...step, attention: step.attention ?? null });
  }
}

/**
 * Minimal sanitizer for SVG markup that arrives from a saved `.ikguide.json` or from the service.
 * We only ever render our own diagrams, but an instruction file can be imported from a USB stick, so
 * scripts, event handlers and `javascript:` URLs are stripped before the markup reaches the DOM.
 */
export function sanitizeSvgMarkup(markup: string | null | undefined): string {
  if (!markup || !markup.trimStart().startsWith('<svg')) {
    return '';
  }
  return markup
    .replace(/<\s*script[\s\S]*?<\s*\/\s*script\s*>/gi, '')
    .replace(/<\s*foreignObject[\s\S]*?<\s*\/\s*foreignObject\s*>/gi, '')
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/javascript:/gi, '');
}
