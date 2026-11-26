import { useCallback, useEffect, useMemo, useState } from 'react';
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
import {
  type GuidePublishError,
  type PublishGuideResult,
  type PublishedGuideSummary,
  type WorkshopNetworkInfo,
  buildPublishedLink,
  fetchPublishedGuides,
  fetchWorkshopNetworkInfo,
  formatGuideSize,
  pickLanApiBase,
  publishGuide,
  workshopApiBase,
} from '../../lib/publishedGuides';
import { useStudio } from '../../state/studio';
import { Modal } from './Modal';

type Tab = 'published' | 'payload' | 'link';

type PublishState =
  | { status: 'idle' }
  | { status: 'publishing' }
  | { status: 'done'; result: PublishGuideResult }
  | { status: 'error'; kind: GuidePublishError['kind'] | 'unknown'; message: string };

interface QrDialogProps {
  doc: IkGuideDocument;
  onClose: () => void;
}

/**
 * «QR-код инструкции» — the three real ways an instruction reaches a phone:
 *
 *  • **published** (default) — the instruction is uploaded to the workshop laptop once and gets a
 *    short code; the QR is a 70-byte link `…/?guideId=<code>&api=http://192.168.1.50:8000`. Nothing is
 *    dropped: full 3D, SVG diagrams and GOST translations travel with the document, and the phone
 *    caches it in the offline library on first open;
 *  • **payload** — the whole guide, deflated, inside the link (`?g=…`): no server at all, but a code
 *    only holds ~2.5 KB, so heavy parts are dropped with an explicit warning;
 *  • **workshop link** — a short link to the guide on the workshop server for the stage-4 route.
 *
 * Plus the two escape hatches for everything that does not fit a code at all: the offline
 * `.ikguide.json` package and a standalone `.html` that opens anywhere.
 */
export function QrDialog({ doc, onClose }: QrDialogProps) {
  const { dispatch } = useStudio();
  const [tab, setTab] = useState<Tab>('published');
  const [workshopBase, setWorkshopBase] = useState(() => defaultWorkshopBaseUrl());
  const [apiBase, setApiBase] = useState(() => workshopApiBase());
  const [network, setNetwork] = useState<WorkshopNetworkInfo | null>(null);
  const [published, setPublished] = useState<PublishState>({ status: 'idle' });
  const [recent, setRecent] = useState<PublishedGuideSummary[]>([]);
  const [recentError, setRecentError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const payload = useMemo(() => encodeGuidePayload(doc, { baseUrl: sanitizeBaseUrl(workshopBase) }), [doc, workshopBase]);
  const stage4Link = useMemo(() => buildWorkshopLink(sanitizeBaseUrl(workshopBase), doc.id), [doc.id, workshopBase]);

  /** Absolute address the phone must use; falls back to what the server says about itself. */
  const linkBase = useMemo(
    () => sanitizeBaseUrl(apiBase) || sanitizeBaseUrl(network?.suggestedApiBase ?? ''),
    [apiBase, network],
  );

  const publishedLink = useMemo(
    () => (published.status === 'done' && linkBase ? buildPublishedLink(linkBase, published.result.id) : null),
    [published, linkBase],
  );

  const target =
    tab === 'published'
      ? publishedLink
      : tab === 'payload'
        ? payload.tooLarge
          ? null
          : payload.url
        : stage4Link;

  // Where the workshop server thinks it lives on the shop LAN + what is already published there.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const info = await fetchWorkshopNetworkInfo();
      if (cancelled || !info) {
        return;
      }
      setNetwork(info);
      const suggested = pickLanApiBase(info);
      if (suggested) {
        // A link with `localhost` is useless to a phone: autofill the real LAN address.
        setApiBase((current) => (sanitizeBaseUrl(current) && !/^https?:\/\/(localhost|127\.)/i.test(current) ? current : suggested));
      }
    })();
    void (async () => {
      try {
        const guides = await fetchPublishedGuides({ limit: 5 });
        if (!cancelled) {
          setRecent(guides);
          setRecentError(null);
        }
      } catch {
        if (!cancelled) {
          setRecentError('Список публикаций недоступен: сервер не отвечает.');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const publish = useCallback(async () => {
    setPublished({ status: 'publishing' });
    setCopied(false);
    try {
      const result = await publishGuide(doc, { baseUrl: sanitizeBaseUrl(apiBase) || undefined });
      setPublished({ status: 'done', result });
      void fetchPublishedGuides({ limit: 5 })
        .then((guides) => {
          setRecent(guides);
          setRecentError(null);
        })
        .catch(() => setRecentError('Список публикаций недоступен: сервер не отвечает.'));
    } catch (publishError) {
      const known = publishError as GuidePublishError;
      setPublished({
        status: 'error',
        kind: known?.kind ?? 'unknown',
        message: known?.message ?? 'Не удалось опубликовать инструкцию.',
      });
    }
  }, [apiBase, doc]);

  // Opening the «Опубликовать в цех» tab is the engineer's intent: publish right away, so the QR is
  // ready before the worker walks over. Re-publishing the same document is free (deduplicated).
  useEffect(() => {
    if (tab === 'published' && published.status === 'idle') {
      void publish();
    }
  }, [published.status, publish, tab]);

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

  const copyLink = async () => {
    if (!publishedLink) {
      return;
    }
    try {
      await navigator.clipboard?.writeText(publishedLink);
      setCopied(true);
      dispatch({ type: 'SHOW_TOAST', tone: 'success', text: 'Ссылка на инструкцию скопирована.' });
    } catch {
      dispatch({ type: 'SHOW_TOAST', tone: 'info', text: 'Браузер не дал скопировать: выделите ссылку вручную.' });
    }
  };

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
          aria-selected={tab === 'published'}
          className={tab === 'published' ? 'qr-tab is-active' : 'qr-tab'}
          onClick={() => setTab('published')}
        >
          Опубликовать в цех
          <small>короткий QR, полная 3D-инструкция</small>
        </button>
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

      {tab === 'published' ? (
        <label className="field qr-base">
          <span className="field-label">Адрес цехового сервера для телефона</span>
          <input
            type="url"
            inputMode="url"
            spellCheck={false}
            placeholder="http://192.168.1.50:8000"
            value={apiBase}
            onChange={(event) => setApiBase(event.target.value)}
          />
          <span className="field-hint">
            {network?.primaryIsLan
              ? `Сервер видит себя в цеховой сети как ${network.primary}:${network.guidePort}. `
              : ''}
            Публикация идёт на этот адрес, и он же записан в QR — телефон скачает инструкцию с ноутбука цеха.
          </span>
        </label>
      ) : (
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
            {tab === 'payload'
              ? 'Этот адрес попадёт в ссылку внутри QR. Для планшета впишите IP цехового ноутбука в локальной сети.'
              : 'Телефон откроет приложение по этому адресу. Для планшета впишите IP цехового ноутбука в локальной сети.'}
          </span>
        </label>
      )}

      <div className="qr-layout">
        <div className="qr-frame">
          {tab === 'payload' && payload.tooLarge ? (
            <div className="qr-too-large">
              <strong>Не помещается в один QR</strong>
              <p>
                Инструкция сжимается до {formatBytes(payload.bytes)} при лимите кода {formatBytes(QR_MAX_BYTES)}. Даже без
                3D-модели, схем и переводов обозначений рабочие шаги не влезают в один код.
              </p>
              <button type="button" className="btn btn-primary btn-small" onClick={() => setTab('published')}>
                Опубликовать в цех
              </button>
            </div>
          ) : tab === 'published' && published.status === 'publishing' ? (
            <div className="qr-placeholder">Публикация…</div>
          ) : tab === 'published' && published.status === 'error' ? (
            <div className="qr-placeholder">Сервер недоступен</div>
          ) : tab === 'published' && published.status === 'done' && !linkBase ? (
            <div className="qr-placeholder">Нужен адрес в цеховой сети</div>
          ) : dataUrl ? (
            <img
              src={dataUrl}
              alt={tab === 'published' ? 'QR-код со ссылкой на инструкцию в цеху' : tab === 'payload' ? 'QR-код с инструкцией' : 'QR-код со ссылкой на инструкцию'}
              width={260}
              height={260}
            />
          ) : (
            <div className="qr-placeholder">{error ? 'Ошибка' : 'Генерация…'}</div>
          )}
        </div>

        <div className="qr-info">
          <div className="qr-title">{doc.metadata.title}</div>
          <div className="muted">
            {doc.metadata.drawingCode} · ревизия {doc.metadata.revision}
          </div>

          {tab === 'published' ? (
            <>
              {published.status === 'done' ? (
                <>
                  <p className="qr-code">
                    Код инструкции: <code>{published.result.id}</code>
                  </p>
                  <ul className="qr-facts">
                    <li>{formatGuideSize(published.result.sizeBytes)} на сервере</li>
                    <li>{published.result.steps} шагов</li>
                    <li>{published.result.has3d ? '3D-узел в комплекте' : 'без 3D-модели'}</li>
                    <li className={linkBase ? 'text-success' : 'text-danger'}>
                      {linkBase ? `адрес ${hostOf(linkBase)}` : 'адрес не задан'}
                    </li>
                  </ul>
                  {published.result.deduplicated ? (
                    <p className="qr-warning">
                      Эта инструкция уже была опубликована — код остался прежним, второй файл на сервере не появился.
                    </p>
                  ) : null}
                  {linkBase ? (
                    <>
                      <p className="muted small">
                        В QR только ссылка: телефон откроет цеховой сервер, скачает инструкцию целиком — с 3D-узлом, схемами
                        и ГОСТ-переводами — и сохранит её офлайн до конца смены.
                      </p>
                      <code className="qr-payload">{publishedLink}</code>
                      <div className="row gap-8 qr-publish-actions">
                        <button type="button" className="btn btn-ghost btn-small" onClick={() => void copyLink()}>
                          {copied ? 'Ссылка скопирована' : 'Скопировать ссылку'}
                        </button>
                        <button type="button" className="btn btn-ghost btn-small" onClick={() => void publish()}>
                          Обновить публикацию
                        </button>
                      </div>
                    </>
                  ) : (
                    <div className="notice notice-warning">
                      <strong>QR ещё нельзя напечатать</strong>
                      <p>
                        Укажите адрес цехового ноутбука в локальной сети — например <code>{network?.suggestedApiBase || 'http://192.168.1.50:8000'}</code>.
                        Ссылка на <code>localhost</code> откроется только на самом ноутбуке.
                      </p>
                    </div>
                  )}
                  {recent.length > 1 ? (
                    <div className="qr-publish-list">
                      <div className="muted small">Уже опубликовано на этом сервере:</div>
                      {recent.map((entry) => (
                        <div key={entry.id} className={entry.id === published.result.id ? 'qr-publish-row is-current' : 'qr-publish-row'}>
                          <code>{entry.id}</code>
                          <span>{entry.title}</span>
                          <span className="muted small">{formatGuideSize(entry.sizeBytes)}</span>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </>
              ) : published.status === 'error' ? (
                <div className="notice notice-danger">
                  <strong>Цеховой сервер не принял инструкцию</strong>
                  <p>{published.message}</p>
                  <p className="muted small">
                    Проверьте, что ноутбук цеха включён и в «Настройках» указан его адрес. Пока сервера нет, инструкцию можно
                    передать автономным QR — он работает без сети, но без 3D-модели.
                  </p>
                </div>
              ) : (
                <p className="muted small">Отправляем инструкцию на цеховой сервер…</p>
              )}

              {published.status === 'error' ? (
                <div className="row gap-8 qr-publish-actions">
                  <button type="button" className="btn btn-primary btn-small" onClick={() => void publish()}>
                    Повторить публикацию
                  </button>
                  <button type="button" className="btn btn-ghost btn-small" onClick={() => setTab('payload')}>
                    Автономный QR без сервера
                  </button>
                </div>
              ) : null}

              {recentError ? <p className="muted small">{recentError}</p> : null}
            </>
          ) : tab === 'payload' ? (
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
                <li>ссылка {formatBytes(stage4Link.length)}</li>
                <li>Android и iPhone</li>
                <li>{doc.metadata.drawingCode}</li>
              </ul>
              <p className="muted small">
                Код ведёт на цеховой сервер: телефон откроет эту инструкцию в браузере и подтянет её из офлайн-хранилища.
                Работает, когда сервер доступен по локальной сети — и на iPhone тоже.
              </p>
              <code className="qr-payload">{stage4Link}</code>
            </>
          )}

          <p className="muted small">
            Служебная ссылка приложения: <code>{buildGuideDeepLink(doc)}</code>
          </p>
          <p className="muted small">На Windows: «{saveLabel()}» откроет системный диалог сохранения.</p>
          {error ? <p className="text-danger small">{error}</p> : null}
        </div>
      </div>
    </Modal>
  );
}

function hostOf(value: string): string {
  return value.replace(/^https?:\/\//i, '').replace(/\/.*$/, '');
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
