import { describe, expect, it } from 'vitest';
import {
  IKEA_PALETTE,
  renderIkeaSvg,
  safeRenderIkeaSvg,
  sanitizeSvgMarkup,
  sceneFromParts,
  type IkeaPartInput,
} from './ikeaSvg';

const PARTS: IkeaPartInput[] = [
  { id: 'p1', center: [0, 0, 0], size: [120, 40, 80], explosionVector: [0, -1, 0], role: 'base' },
  { id: 'p2', center: [0, 24, 0], size: [60, 8, 40], explosionVector: [0, 1, 0], role: 'part' },
  { id: 'p3', center: [40, 34, 20], size: [10, 20, 10], explosionVector: [0, 1, 0], role: 'fastener' },
];

const SCENE = { parts: PARTS, diagonal: 160 };

const ALLOWED = new Set(Object.values(IKEA_PALETTE).map((value) => value.toLowerCase()));

function coloursOf(svg: string): string[] {
  return [...svg.matchAll(/(?:fill|stroke)="(#[0-9A-Fa-f]{6})"/g)].map((match) => match[1]!.toLowerCase());
}

describe('offline IKEA SVG renderer', () => {
  it('produces a standalone SVG document with the palette only', () => {
    const svg = renderIkeaSvg(SCENE, {
      activePartIds: ['p2'],
      installedPartIds: ['p1'],
      azimuth: 35,
      elevation: 26,
      caption: 'Шаг 2. Установи крышку',
    });

    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    expect(svg.endsWith('</svg>')).toBe(true);
    expect(svg).toContain('viewBox="0 0 720 520"');
    expect(svg).not.toContain('<image');
    expect(svg).not.toContain('<script');

    for (const colour of coloursOf(svg)) {
      expect(ALLOWED.has(colour), `лишний цвет ${colour}`).toBe(true);
    }
    // Every semantic colour is actually used: paper, ink, installed grey, active blue and red accent.
    const used = new Set(coloursOf(svg));
    expect(used.has(IKEA_PALETTE.ink.toLowerCase())).toBe(true);
    expect(used.has(IKEA_PALETTE.installed.toLowerCase())).toBe(true);
    expect(used.has(IKEA_PALETTE.activeFill.toLowerCase())).toBe(true);
    expect(used.has(IKEA_PALETTE.activeLine.toLowerCase())).toBe(true);
  });

  it('draws the assembly axis and the bold blue arrow for the active part', () => {
    const svg = renderIkeaSvg(SCENE, { activePartIds: ['p2'], installedPartIds: ['p1'] });
    expect(svg).toContain('class="install-arrow"');
    expect(svg).toContain('class="assembly-axis"');
    expect(svg).toContain('stroke-dasharray="7 6"');
    expect(svg).toContain(`fill="${IKEA_PALETTE.activeFill}"`);
  });

  it('marks critical steps with the red attention badge', () => {
    const svg = renderIkeaSvg(SCENE, { activePartIds: ['p3'], attention: 'Не перетяните болт' });
    expect(svg).toContain('class="attention"');
    expect(svg).toContain(`stroke="${IKEA_PALETTE.attention}"`);
  });

  it('is deterministic and follows the camera angles', () => {
    const first = renderIkeaSvg(SCENE, { activePartIds: ['p2'], azimuth: 35, elevation: 26 });
    const second = renderIkeaSvg(SCENE, { activePartIds: ['p2'], azimuth: 35, elevation: 26 });
    const other = renderIkeaSvg(SCENE, { activePartIds: ['p2'], azimuth: 140, elevation: 62 });

    expect(first).toBe(second);
    expect(other).not.toBe(first);
    expect(first).toContain('data-azimuth="35"');
    expect(other).toContain('data-azimuth="140"');
  });

  it('hides future parts and ghosts the ones that come next', () => {
    const withHidden = renderIkeaSvg(SCENE, { activePartIds: ['p2'], installedPartIds: ['p1'], hiddenPartIds: ['p3'] });
    expect(withHidden).not.toContain('data-part="p3"');

    const ghosted = renderIkeaSvg(SCENE, { activePartIds: ['p2'], installedPartIds: ['p1'] });
    expect(ghosted).toContain('data-part="p3"');
    expect(ghosted).toContain('stroke-dasharray="5 5"');
  });

  it('draws an empty placeholder instead of failing on an empty assembly', () => {
    const svg = safeRenderIkeaSvg(null, { activePartIds: ['ghost-id'] });
    expect(svg).toContain('Нет геометрии');
    expect(svg.startsWith('<svg')).toBe(true);
  });

  it('derives a scene from schema parts (no centroids, bbox only)', () => {
    const scene = sceneFromParts([
      {
        id: 'p1',
        nodeName: 'korpus',
        displayName: 'Корпус',
        role: 'base',
        stepNumber: 1,
        explosionVector: [0, -1, 0],
        bboxMm: { x: 100, y: 40, z: 80 },
      },
    ]);
    expect(scene.parts[0]?.size).toEqual([100, 40, 80]);
    expect(scene.diagonal).toBeGreaterThan(100);
  });
});

describe('sanitizeSvgMarkup', () => {
  it('rejects anything that is not an SVG document', () => {
    expect(sanitizeSvgMarkup(undefined)).toBe('');
    expect(sanitizeSvgMarkup('<div>нет</div>')).toBe('');
    expect(sanitizeSvgMarkup('   ')).toBe('');
  });

  it('strips scripts, event handlers and javascript: URLs from imported instructions', () => {
    const dirty =
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script>' +
      '<rect width="10" height="10" fill="#FFFFFF" onload="alert(2)"/>' +
      '<a href="javascript:alert(3)"><text>шаг</text></a></svg>';
    const clean = sanitizeSvgMarkup(dirty);
    expect(clean.startsWith('<svg')).toBe(true);
    expect(clean).not.toContain('<script');
    expect(clean).not.toContain('onload');
    expect(clean).not.toContain('javascript:');
    expect(clean).toContain('<text>шаг</text>');
  });
});
