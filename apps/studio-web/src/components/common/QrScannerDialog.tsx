import { useCallback, useEffect, useRef, useState } from 'react';
import type jsQRType from 'jsqr';
import { readDataUrl } from '../../lib/download';
import { listGuides } from '../../lib/offlineStore';
import { decodeGuidePayload, extractGuideId } from '../../lib/qrBridge';
import { useStudio } from '../../state/studio';
import { Modal } from './Modal';

type Status = 'idle' | 'starting' | 'scanning' | 'reading' | 'error';

/**
 * «Сканер QR-кода» — the worker's door into an instruction.
 *
 * Live camera with an aiming frame (jsQR on a downscaled canvas), a gallery photo for a code printed
 * on paper, and a manual field for a link somebody dictated over the phone. Everything that decodes
 * is stored offline before the first step is shown.
 */
export function QrScannerDialog({ onClose }: { onClose: () => void }) {
  const { state, adoptGuide, dispatch } = useStudio();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const frameRef = useRef<number | null>(null);
  const doneRef = useRef(false);
  const [status, setStatus] = useState<Status>('idle');
  const [message, setMessage] = useState<string | null>(null);
  const [manual, setManual] = useState('');
  const decoderRef = useRef<typeof jsQRType | null>(null);

  // jsQR is ~40 KB of pure JS: loaded only when the worker actually opens the scanner.
  useEffect(() => {
    let cancelled = false;
    void import('jsqr').then((module) => {
      if (!cancelled) {
        decoderRef.current = module.default;
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const stopCamera = useCallback(() => {
    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  const openGuide = useCallback(
    async (text: string, source: 'scan' | 'qr') => {
      setStatus('reading');
      setMessage(null);
      try {
        const doc = decodeGuidePayload(text);
        await adoptGuide(doc, source);
        dispatch({
          type: 'SHOW_TOAST',
          tone: 'success',
          text: `Инструкция «${doc.metadata.title}» получена и сохранена офлайн.`,
        });
        doneRef.current = true;
        stopCamera();
        onClose();
      } catch (error) {
        // A studio link (`?guide=<id>`) carries only an id: resolve it against what is already here.
        const id = extractGuideId(text);
        const known = id
          ? (await listGuides()).find((entry) => entry.id === id) ??
            state.docs.find((candidate) => candidate.id === id)
          : undefined;
        if (known) {
          const doc = 'doc' in known ? known.doc : known;
          await adoptGuide(doc, 'qr');
          dispatch({ type: 'SHOW_TOAST', tone: 'success', text: `Инструкция «${doc.metadata.title}» открыта с сервера.` });
          doneRef.current = true;
          stopCamera();
          onClose();
          return;
        }
        setStatus('error');
        setMessage(error instanceof Error ? error.message : 'Код не распознан.');
      }
    },
    [adoptGuide, dispatch, onClose, state.docs, stopCamera],
  );

  const scanFrame = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || doneRef.current) {
      return;
    }
    if (video.readyState === video.HAVE_ENOUGH_DATA && video.videoWidth > 0) {
      const maxSide = 640;
      const scale = Math.min(1, maxSide / Math.max(video.videoWidth, video.videoHeight));
      const width = Math.round(video.videoWidth * scale);
      const height = Math.round(video.videoHeight * scale);
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (context) {
        context.drawImage(video, 0, 0, width, height);
        const image = context.getImageData(0, 0, width, height);
        const decoder = decoderRef.current;
        const found = decoder ? decoder(image.data, image.width, image.height, { inversionAttempts: 'attemptBoth' }) : null;
        if (found?.data) {
          doneRef.current = true;
          void openGuide(found.data, 'scan');
          return;
        }
      }
    }
    frameRef.current = requestAnimationFrame(scanFrame);
  }, [openGuide]);

  const startCamera = useCallback(async () => {
    setMessage(null);
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setStatus('error');
      setMessage('Камера недоступна в этом браузере. Выберите фото QR-кода из галереи или вставьте ссылку вручную.');
      return;
    }
    setStatus('starting');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false,
      });
      streamRef.current = stream;
      const video = videoRef.current;
      if (video) {
        video.srcObject = stream;
        await video.play().catch(() => undefined);
      }
      doneRef.current = false;
      setStatus('scanning');
      frameRef.current = requestAnimationFrame(scanFrame);
    } catch {
      setStatus('error');
      setMessage('Не удалось включить камеру: разрешение не выдано. Разрешите доступ или выберите фото QR-кода.');
    }
  }, [scanFrame]);

  useEffect(() => () => stopCamera(), [stopCamera]);

  const onGalleryFile = async (file: File | undefined) => {
    if (!file) {
      return;
    }
    setStatus('reading');
    setMessage(null);
    try {
      const dataUrl = await readDataUrl(file);
      const bitmap = await loadImage(dataUrl);
      const canvas = canvasRef.current ?? document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) {
        throw new Error('Не удалось прочитать изображение.');
      }
      context.drawImage(bitmap, 0, 0);
      const image = context.getImageData(0, 0, canvas.width, canvas.height);
      const decoder = decoderRef.current ?? (await import('jsqr')).default;
      decoderRef.current = decoder;
      const found = decoder(image.data, image.width, image.height, { inversionAttempts: 'attemptBoth' });
      if (!found?.data) {
        setStatus('error');
        setMessage('На фото не найден QR-код. Сфотографируйте его целиком и ровно, без бликов.');
        return;
      }
      await openGuide(found.data, 'scan');
    } catch (error) {
      setStatus('error');
      setMessage(error instanceof Error ? error.message : 'Не удалось разобрать фото.');
    }
  };

  return (
    <Modal
      title="Сканер QR-кода"
      subtitle="Наведите камеру на код с экрана инженера или на распечатку."
      onClose={() => {
        stopCamera();
        onClose();
      }}
      footer={
        <div className="row gap-8">
          <label className="btn btn-ghost btn-small">
            Выбрать фото QR-кода из галереи
            <input
              type="file"
              accept="image/*"
              hidden
              onChange={(event) => {
                void onGalleryFile(event.target.files?.[0]);
                event.target.value = '';
              }}
            />
          </label>
          <div className="spacer" />
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => {
              stopCamera();
              onClose();
            }}
          >
            Закрыть
          </button>
        </div>
      }
    >
      <div className="scanner">
        <div className={`scanner-frame ${status === 'scanning' ? 'is-live' : ''}`}>
          <video ref={videoRef} playsInline muted className="scanner-video" />
          <div className="scanner-aim" aria-hidden="true">
            <span className="scanner-corner scanner-corner-tl" />
            <span className="scanner-corner scanner-corner-tr" />
            <span className="scanner-corner scanner-corner-bl" />
            <span className="scanner-corner scanner-corner-br" />
          </div>
          {status !== 'scanning' ? (
            <div className="scanner-overlay">
              {status === 'starting' || status === 'reading' ? (
                <p>Читаю код…</p>
              ) : (
                <button type="button" className="btn btn-primary" onClick={() => void startCamera()}>
                  Включить камеру
                </button>
              )}
            </div>
          ) : null}
        </div>
        <canvas ref={canvasRef} hidden />

        <div className="scanner-side">
          <p className="muted small">
            Камера читает код локально: кадры не уходят в сеть. Подойдёт и фото кода из галереи — например, если инструкцию
            сфотографировали в цехе.
          </p>
          <label className="field">
            <span className="field-label">Ссылка или код вручную</span>
            <textarea
              rows={3}
              spellCheck={false}
              placeholder="http://192.168.1.50:5173/?g=…"
              value={manual}
              onChange={(event) => setManual(event.target.value)}
            />
          </label>
          <button
            type="button"
            className="btn btn-primary btn-small"
            disabled={manual.trim().length === 0}
            onClick={() => void openGuide(manual, 'qr')}
          >
            Открыть инструкцию
          </button>
          {message ? <p className="text-danger small">{message}</p> : null}
          {status === 'idle' ? (
            <p className="muted small">
              Нет камеры под рукой? Инженер может прислать ссылку или файл <code>.ikguide.json</code> — он открывается кнопкой
              «Инструкция» на главном экране.
            </p>
          ) : null}
        </div>
      </div>
    </Modal>
  );
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Не удалось открыть изображение.'));
    image.src = src;
  });
}
