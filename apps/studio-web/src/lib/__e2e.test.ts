// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { buildGuideFromVision } from '@ikguide/builder';
import { buildIllustrations } from './illustrations';
import { renderPdf } from './pdfExport';

it('реальный ответ vision-api даёт документ и PDF', async () => {
  const response = JSON.parse(readFileSync('/tmp/vision.json', 'utf8'));
  const built = buildGuideFromVision(response, { title: 'Кронштейн КС-04', createdAt: '2026-11-26T10:00:00Z' });
  const doc = built.document;
  const job = await renderPdf(doc, buildIllustrations(doc));
  writeFileSync('/tmp/e2e.pdf', job.bytes);
  console.log('pdf', job.fileName, job.bytes.byteLength, 'байт, страниц', job.plan.pages.length);
  expect(job.bytes.byteLength).toBeGreaterThan(20000);
}, 60_000);
