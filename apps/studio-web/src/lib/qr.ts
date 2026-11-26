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

/** Real scannable QR code, rendered to a PNG data URL. */
export async function createQrDataUrl(text: string): Promise<string> {
  return QRCode.toDataURL(text, {
    errorCorrectionLevel: 'M',
    margin: 1,
    width: 640,
    color: {
      dark: '#111318',
      light: '#FFFFFF',
    },
  });
}
