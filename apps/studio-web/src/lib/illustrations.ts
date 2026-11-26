/**
 * Из документа `IkGuideDocument` в готовые SVG-схемы для PDF и предпросмотра.
 *
 * Один и тот же SVG уходит и на экран, и в PDF: у pdf-exporter нет своей графики, поэтому
 * «что вижу — то и печатаю». Для 3D документ хранит камеру шага (`cameraView`), так что смена
 * ракурса в интерфейсе — это просто новая отрисовка той же сцены.
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { GuideStep, IkGuideDocument } from '@ikguide/schema';
import type { IllustrationInput } from '@ikguide/pdf-exporter';
import { artFor, DrawingSheet } from '../art/registry';
import { renderIkeaSvg, sceneFromParts, type IkeaSceneGeometry } from './ikeaSvg';

export interface Illustrations {
  cover: IllustrationInput | undefined;
  steps: Record<string, IllustrationInput>;
}

/** Фрагменты настоящего листа (после распознавания): приоритетнее нарисованных схем. */
export interface FragmentInput {
  steps?: Readonly<Record<string, string>>;
  cover?: string | null;
}

const DEFAULT_AZIMUTH = 35;
const DEFAULT_ELEVATION = 26;

function sceneOf(doc: IkGuideDocument): IkeaSceneGeometry | null {
  const assembly = doc.assembly3d;
  if (!assembly) {
    return null;
  }
  const centers: Record<string, [number, number, number]> = {};
  for (const part of assembly.parts) {
    if (part.centerMm) {
      centers[part.id] = [part.centerMm.x, part.centerMm.y, part.centerMm.z];
    }
  }
  return sceneFromParts(assembly.parts, centers);
}

/** Некоторые арт-компоненты оборачивают схему в `<div class="sheet">`: PDF-у нужен чистый `<svg>`. */
export function unwrapSvg(markup: string): string {
  const start = markup.indexOf('<svg');
  const end = markup.lastIndexOf('</svg>');
  return start >= 0 && end > start ? markup.slice(start, end + 6) : markup;
}

function captionOf(step: GuideStep): string {
  const check = step.criticalChecks[0];
  return check ? `${step.title} · ${check.label}: ${check.nominal}` : step.title;
}

function artSvg(step: GuideStep): string {
  const Component = artFor(step.illustration);
  return unwrapSvg(
    renderToStaticMarkup(
      createElement(Component, { highlight: step.illustration.highlight, arrows: step.illustration.arrows }),
    ),
  );
}

/** 3D-схема шага: активные детали синие, уже собранные — контуром, будущие — призраком. */
export function step3dSvg(doc: IkGuideDocument, step: GuideStep, azimuth?: number, elevation?: number): string | null {
  const scene = sceneOf(doc);
  if (!scene) {
    return null;
  }
  const camera = step.cameraView;
  const active = step.activePartIds ?? [];
  const installed = step.installedPartIds ?? [];
  const hidden = scene.parts
    .map((part) => part.id)
    .filter((id) => !active.includes(id) && !installed.includes(id));
  return renderIkeaSvg(scene, {
    activePartIds: active,
    installedPartIds: installed,
    hiddenPartIds: hidden,
    explode: active.length > 1 ? 0.55 : 0.4,
    azimuth: azimuth ?? camera?.azimuth ?? DEFAULT_AZIMUTH,
    elevation: elevation ?? camera?.elevation ?? DEFAULT_ELEVATION,
  });
}

/** Общая схема изделия для титульного листа. */
export function coverSvg(doc: IkGuideDocument): string | undefined {
  const scene = sceneOf(doc);
  if (scene) {
    const assembly = doc.assembly3d!;
    return renderIkeaSvg(scene, {
      installedPartIds: assembly.parts.map((part) => part.id),
      explode: 0.32,
      azimuth: DEFAULT_AZIMUTH,
      elevation: DEFAULT_ELEVATION,
    });
  }
  if (!doc.assembly3d && doc.drawing.viewId) {
    return unwrapSvg(renderToStaticMarkup(createElement(DrawingSheet, { viewId: doc.drawing.viewId })));
  }
  return undefined;
}

export function buildIllustrations(doc: IkGuideDocument, fragments: FragmentInput = {}): Illustrations {
  const steps: Record<string, IllustrationInput> = {};
  for (const step of doc.steps) {
    const fragment = fragments.steps?.[step.id];
    if (fragment) {
      steps[step.id] = { imageDataUrl: fragment, caption: captionOf(step) };
      continue;
    }
    const svg = doc.assembly3d ? step3dSvg(doc, step) : (step.svgDiagram ?? artSvg(step));
    steps[step.id] = { svg: svg ?? undefined, caption: captionOf(step) };
  }

  if (fragments.cover) {
    return {
      cover: { imageDataUrl: fragments.cover, caption: 'Общий вид: лист чертежа' },
      steps,
    };
  }
  const cover = coverSvg(doc);
  return {
    cover: cover ? { svg: cover, caption: doc.assembly3d ? 'Общий вид узла в сборе' : 'Общий вид по чертежу' } : undefined,
    steps,
  };
}
