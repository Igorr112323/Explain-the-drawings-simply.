import { useEffect, useState } from 'react';
import type { IkGuideDocument } from '@ikguide/schema';
import { buildGuideDeepLink, createQrDataUrl } from '../../lib/qr';
import { downloadDataUrl, sanitizeFileName } from '../../lib/download';
import { Modal } from './Modal';

interface QrDialogProps {
  doc: IkGuideDocument;
  onClose: () => void;
}

export function QrDialog({ doc, onClose }: QrDialogProps) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const deepLink = buildGuideDeepLink(doc);

  useEffect(() => {
    let cancelled = false;
    setDataUrl(null);
    setError(null);
    createQrDataUrl(deepLink)
      .then((url) => {
        if (!cancelled) {
          setDataUrl(url);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setError('Не удалось построить QR-код. Проверьте, что ссылка не пустая.');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [deepLink]);

  return (
    <Modal
      title="QR-код инструкции"
      subtitle="Рабочий наводит камеру телефона — открывается эта инструкция в цеховом приложении."
      onClose={onClose}
      footer={
        <div className="row gap-8">
          <button
            type="button"
            className="btn btn-ghost"
            disabled={!dataUrl}
            onClick={() => {
              if (dataUrl) {
                downloadDataUrl(`${sanitizeFileName(doc.metadata.drawingCode)}-qr.png`, dataUrl);
              }
            }}
          >
            Скачать PNG
          </button>
          <button type="button" className="btn btn-primary" onClick={onClose}>
            Готово
          </button>
        </div>
      }
    >
      <div className="qr-layout">
        <div className="qr-frame">
          {dataUrl ? <img src={dataUrl} alt="QR-код инструкции" width={260} height={260} /> : <div className="qr-placeholder">Генерация…</div>}
        </div>
        <div className="qr-info">
          <div className="qr-title">{doc.metadata.title}</div>
          <div className="muted">{doc.metadata.drawingCode} · ревизия {doc.metadata.revision}</div>
          <ul className="qr-facts">
            <li>{doc.steps.length} шагов</li>
            <li>{doc.xrayAnnotations.length} обозначений на чертеже</li>
            <li>{doc.tools.length} позиций инструмента</li>
          </ul>
          <p className="muted small">
            В QR зашита ссылка <code>ikguide://guide/{doc.id}</code> с контрольной суммой документа. На этапе 4 её
            откроет приложение на Android через Capacitor.
          </p>
          {error ? <p className="text-danger small">{error}</p> : null}
        </div>
      </div>
    </Modal>
  );
}
