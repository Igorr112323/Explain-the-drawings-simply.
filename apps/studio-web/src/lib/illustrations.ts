/**
 * Из документа `IkGuideDocument` в готовые SVG-схемы для PDF и предпросмотра.
 *
 * Один и тот же SVG уходит и на экран, и в PDF: у pdf-exporter нет своей графики, поэтому
 * «что вижу — то и печатаю». Если шаг пришёл из распознанного листа, приоритет у настоящего
 * фрагмента чертежа (`fragments`), а векторная схема остаётся запасным вариантом.
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { GuideStep, IkGuideDocument } from '@ikguide/schema';
import type { IllustrationInput } from '@ikguide/pdf-exporter';
import { artFor, DrawingSheet } from '../art/registry';

export interface Illustrations {
  cover: IllustrationInput | undefined;
  steps: Record<string, IllustrationInput>;
}

/** Фрагменты настоящего листа (после распознавания): приоритетнее нарисованных схем. */
export interface FragmentInput {
  steps?: Readonly<Record<string, string>>;
  cover?: string | null;
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

/** Общая схема изделия для титульного листа — та же, что на листе чертежа. */
export function coverSvg(doc: IkGuideDocument): string | undefined {
  if (!doc.drawing.viewId) {
    return undefined;
  }
  return unwrapSvg(renderToStaticMarkup(createElement(DrawingSheet, { viewId: doc.drawing.viewId })));
}

export function buildIllustrations(doc: IkGuideDocument, fragments: FragmentInput = {}): Illustrations {
  const steps: Record<string, IllustrationInput> = {};
  for (const step of doc.steps) {
    const fragment = fragments.steps?.[step.id];
    if (fragment) {
      steps[step.id] = { imageDataUrl: fragment, caption: captionOf(step) };
      continue;
    }
    steps[step.id] = { svg: step.svgDiagram ?? artSvg(step), caption: captionOf(step) };
  }

  if (fragments.cover) {
    return {
      cover: { imageDataUrl: fragments.cover, caption: 'Общий вид: лист чертежа' },
      steps,
    };
  }
  const cover = coverSvg(doc);
  return { cover: cover ? { svg: cover, caption: 'Общий вид по чертежу' } : undefined, steps };
}
