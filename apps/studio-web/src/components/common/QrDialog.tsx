import { useEffect, useMemo, useState } from 'react';
import type { IkGuideDocument } from '@ikguide/schema';
import { buildGuideDeepLink, createQrDataUrl } from '../../lib/qr';
import { downloadDataUrl, sanitizeFileName } from '../../lib/download';
import { guideFileName, saveLabel, saveTextFile } from '../../lib/nativeExport';
import { defaultWorkshopBaseUrl, sanitizeBaseUrl } from '../../lib/runtimeConfig';
import {
  QR_MAX_BYTES,
  buildOfflinePackage,
  buildStandaloneHtml,
  buildWorkshopLink,
  encodeGuidePayload,
} from '../../lib/qrBridge';
import { useStudio } from '../../state/studio';
import { Modal } from './Modal';

type Tab = 'payload' | 'link';

interface QrDialogProps {
  doc: IkGuideDocument;
  onClose: () => void;
}

/**
 * «QR-код инструкции» with the two real ways an instruction reaches a phone:
 *
 *  • **payload** — the whole guide, deflated, inside the link (`?g=…`): no server needed, but a
 *    code only holds ~2.5 KB, so heavy parts are dropped with an explicit warning;
 *  • **workshop link** — a 60-byte link to the guide on the workshop server: always fits any phone,
 *    but needs the local network.
 *
 * Plus the two escape hatches for everything that does not fit a code at all: the offline
 * `.ikguide.json` package and a standalone `.html` that opens anywhere.
 */
export function QrDialog({ doc, onClose }: QrDialogProps) {
  const { dispatch } = useStudio();
  const [tab, setTab] = useState<Tab>('payload');
  const [workshopBase, setWorkshopBase] = useState(() => defaultWorkshopBaseUrl());
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const payload = useMemo(() => encodeGuidePayload(doc, { baseUrl: sanitizeBaseUrl(workshopBase) }), [doc, workshopBase]);
  const link = useMemo(() => buildWorkshopLink(sanitizeBaseUrl(workshopBase), doc.id), [doc.id, workshopBase]);
  const target = tab === 'payload' ? (payload.tooLarge ? null : payload.url) : link;

  useEffect(() => {
    let cancelled = false;
    setDataUrl(null);
    setError(null);
    if (!target) {
      return () => {
        cancelled = true;
      };
    }
    createQrDataUrl(target, { errorCorrectionLevel: 'L' })
      .then((url) => {
        if (!cancelled) {
          setDataUrl(url);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setError('Не удалось построить QR-код: ссылка слишком длинная для кода этого размера.');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [target]);

  const savePackage = async () => {
    const result = await saveTextFile(guideFileName(doc.metadata.drawingCode), buildOfflinePackage(doc), { kind: 'json' });
    if (result.saved) {
      dispatch({
        type: 'SHOW_TOAST',
        tone: 'success',
        text: result.path ? `Пакет сохранён: ${result.path}` : 'Автономный пакет .ikguide.json скачан.',
      });
    }
  };

  const saveHtml = async () => {
    const html = buildStandaloneHtml(doc);
    const result = await saveTextFile(`${sanitizeFileName(doc.metadata.drawingCode)}-инструкция.html`, html, {
      kind: 'html',
      mimeType: 'text/html',
    });
    if (result.saved) {
      dispatch({
        type: 'SHOW_TOAST',
        tone: 'success',
        text: result.path
          ? `HTML-инструкция сохранена: ${result.path}`
          : 'Автономный HTML-файл скачан: открывается без интернета и без приложения.',
      });
    }
  };

  return (
    <Modal
      title="QR-код инструкции"
      subtitle="Рабочий наводит камеру телефона — инструкция открывается на его экране."
      onClose={onClose}
      wide
      footer={
        <div className="row gap-8 qr-footer">
          <button type="button" className="btn btn-ghost btn-small" onClick={() => void savePackage()}>
            Скачать автономный офлайн-пакет (.ikguide.json)
          </button>
          <button type="button" className="btn btn-ghost btn-small" onClick={() => void saveHtml()}>
            Экспорт автономного HTML-файла
          </button>
          <div className="spacer" />
          <button
            type="button"
            className="btn btn-ghost"
            disabled={!dataUrl}
            onClick={() => dataUrl && downloadDataUrl(`${sanitizeFileName(doc.metadata.drawingCode)}-qr.png`, dataUrl)}
          >
            Скачать QR PNG
          </button>
          <button type="button" className="btn btn-primary" onClick={onClose}>
            Готово
          </button>
        </div>
      }
    >
      <div className="qr-tabs" role="tablist" aria-label="Способ передачи">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'payload'}
          className={tab === 'payload' ? 'qr-tab is-active' : 'qr-tab'}
          onClick={() => setTab('payload')}
        >
          Инструкция в QR
          <small>без сервера, офлайн</small>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'link'}
          className={tab === 'link' ? 'qr-tab is-active' : 'qr-tab'}
          onClick={() => setTab('link')}
        >
          QR по цеховой ссылке
          <small>любой телефон, нужен сервер</small>
        </button>
      </div>

      <label className="field qr-base">
        <span className="field-label">Адрес цехового сервера</span>
        <input
          type="url"
          inputMode="url"
          spellCheck={false}
          placeholder="http://192.168.1.50:5173"
          value={workshopBase}
          onChange={(event) => setWorkshopBase(event.target.value)}
        />
        <span className="field-hint">
          Телефон откроет приложение по этому адресу. Для планшета впишите IP цехового ноутбука в локальной сети.
        </span>
      </label>

      <div className="qr-layout">
        <div className="qr-frame">
          {tab === 'payload' && payload.tooLarge ? (
            <div className="qr-too-large">
              <strong>Не помещается в один QR</strong>
              <p>
                Инструкция сжимается до {formatBytes(payload.bytes)} при лимите кода {formatBytes(QR_MAX_BYTES)}. Даже без
                3D-модели, схем и переводов обозначений рабочие шаги не влезают в один код.
              </p>
              <button type="button" className="btn btn-primary btn-small" onClick={() => setTab('link')}>
                Взять цеховую ссылку
              </button>
            </div>
          ) : dataUrl ? (
            <img src={dataUrl} alt={tab === 'payload' ? 'QR-код с инструкцией' : 'QR-код со ссылкой на инструкцию'} width={260} height={260} />
          ) : (
            <div className="qr-placeholder">{error ? 'Ошибка' : 'Генерация…'}</div>
          )}
        </div>

        <div className="qr-info">
          <div className="qr-title">{doc.metadata.title}</div>
          <div className="muted">{doc.metadata.drawingCode} · ревизия {doc.metadata.revision}</div>

          {tab === 'payload' ? (
            <>
              <ul className="qr-facts">
                <li>{doc.steps.length} шагов</li>
                <li>{doc.tools.length} инструментов</li>
                <li>{doc.qcChecklist.length} пунктов ОТК</li>
                <li className={payload.tooLarge ? 'text-danger' : 'text-success'}>
                  {formatBytes(payload.bytes)} из {formatBytes(QR_MAX_BYTES)}
                </li>
              </ul>
              {payload.warnings.map((warning) => (
                <p key={warning} className="qr-warning">
                  {warning}
                </p>
              ))}
              {payload.tooLarge ? (
                <p className="muted small">
                  Ссылка всё равно рабочая: передайте её по сети или сохраните пакет .ikguide.json и HTML-файл ниже.
                </p>
              ) : (
                <p className="muted small">
                  В QR упакована инструкция целиком: шаги, инструмент, чек-лист и контрольные размеры. Телефону не нужен
                  интернет — только камера.
                </p>
              )}
              <code className="qr-payload">{payload.tooLarge ? '—' : truncate(payload.payload)}</code>
            </>
          ) : (
            <>
              <ul className="qr-facts">
                <li>ссылка {formatBytes(link.length)}</li>
                <li>Android и iPhone</li>
                <li>{doc.metadata.drawingCode}</li>
              </ul>
              <p className="muted small">
                Код ведёт на цеховой сервер: телефон откроет эту инструкцию в браузере и подтянет её из офлайн-хранилища.
                Работает, когда сервер доступен по локальной сети — и на iPhone тоже.
              </p>
              <code className="qr-payload">{link}</code>
            </>
          )}

          <p className="muted small">
            Служебная ссылка приложения: <code>{buildGuideDeepLink(doc)}</code>
          </p>
          <p className="muted small">
            На Windows: «{saveLabel()}» откроет системный диалог сохранения.
          </p>
          {error ? <p className="text-danger small">{error}</p> : null}
        </div>
      </div>
    </Modal>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} Б`;
  }
  return `${(bytes / 1024).toFixed(1)} КБ`;
}

function truncate(value: string): string {
  return value.length > 64 ? `${value.slice(0, 28)}…${value.slice(-24)}` : value;
}
