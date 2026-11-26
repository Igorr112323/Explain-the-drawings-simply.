import { describe, expect, it } from 'vitest';
import { fnv1aHex } from './hash';
import { buildGuideDeepLink } from './qr';
import { bracketDocument } from '../data/bracket';

describe('guide fingerprint and deep link', () => {
  it('produces a stable 8-character FNV-1a hash', () => {
    expect(fnv1aHex('')).toBe('811C9DC5');
    expect(fnv1aHex('ikguide')).toBe(fnv1aHex('ikguide'));
    expect(fnv1aHex('ikguide')).not.toBe(fnv1aHex('ikguidf'));
    expect(fnv1aHex('drawing')).toMatch(/^[0-9A-F]{8}$/);
  });

  it('builds a deep link with code, revision, step count and checksum', () => {
    const link = buildGuideDeepLink(bracketDocument);
    expect(link.startsWith('ikguide://guide/guide-ks04-bracket?')).toBe(true);

    const params = new URL(link.replace('ikguide://', 'https://')).searchParams;
    expect(params.get('code')).toBe(bracketDocument.metadata.drawingCode);
    expect(params.get('rev')).toBe(bracketDocument.metadata.revision);
    expect(params.get('steps')).toBe(String(bracketDocument.steps.length));
    expect(params.get('sha')).toMatch(/^[0-9A-F]{8}$/);
  });

  it('changes the checksum when the document changes', () => {
    const changed = {
      ...bracketDocument,
      metadata: { ...bracketDocument.metadata, revision: 'C' },
    };
    expect(buildGuideDeepLink(changed)).not.toBe(buildGuideDeepLink(bracketDocument));
  });
});
