import { buildGuideFromVision, type BuildOptions, type BuildResult } from '@ikguide/builder';
import type { VisionSession } from './vision';

/**
 * Re-builds the instruction draft from the current vision session. Called both right after
 * recognition and every time the engineer adds an ROI or a hand-typed cipher, so the document always
 * reflects what the person sees on the «Рентген» screen.
 */
export function buildDraftFromSession(session: VisionSession, overrides: BuildOptions = {}): BuildResult {
  return buildGuideFromVision(
    {
      ...(session.requestId ? { requestId: session.requestId } : {}),
      pages: session.pages,
      titleBlock: session.titleBlock,
      candidates: session.candidates,
      warnings: session.warnings,
    },
    {
      ...overrides,
      manualNotations: session.manualNotations.map((text) => ({ text })),
    },
  );
}

export function draftSummary(result: BuildResult): string {
  const { stats } = result;
  const parts = [
    `${stats.steps} шагов`,
    `${stats.tools} инструментов`,
    `${stats.uncertain > 0 ? `${stats.uncertain} на проверку` : 'всё уверенно'}`,
  ];
  return `Черновик готов: ${parts.join(', ')}.`;
}
