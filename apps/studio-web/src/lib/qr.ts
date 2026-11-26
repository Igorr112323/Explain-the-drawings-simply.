import QRCode from 'qrcode';
import type { IkGuideDocument } from '@ikguide/schema';
import { serializeDocument } from '@ikguide/schema';
import { fnv1aHex } from './hash';

export function buildGuideDeepLink(doc: IkGuideDocument): string {
  const params = new URLSearchParams({
    code: doc.metadata.drawingCode,
    rev: doc.metadata.revision,
    steps: String(doc.steps.length),
    sha: fnv1aHex(serializeDocument(doc)),
  });
  return `ikguide://guide/${encodeURIComponent(doc.id)}?${params.toString()}`;
}

/**
 * Real scannable QR code, rendered to a PNG data URL.
 *
 * Long links (a compressed instruction, ~2.9 KB) only fit a version-40 code with the lowest error
 * correction level, so the level drops automatically once the payload gets big.
 */
export async function createQrDataUrl(
  text: string,
  options: { errorCorrectionLevel?: 'L' | 'M' | 'Q' | 'H' } = {},
): Promise<string> {
  const level = options.errorCorrectionLevel ?? (text.length > 1200 ? 'L' : 'M');
  return QRCode.toDataURL(text, {
    errorCorrectionLevel: level,
    margin: 1,
    width: 640,
    color: {
      dark: '#111318',
      light: '#FFFFFF',
    },
  });
}
