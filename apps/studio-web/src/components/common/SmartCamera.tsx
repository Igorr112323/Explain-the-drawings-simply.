import { useCallback, useEffect, useRef, useState } from 'react';

type CameraStatus = 'starting' | 'live' | 'denied' | 'unsupported';

export interface CameraMetrics {
  brightness: number;
  sharpness: number;
}

interface SmartCameraProps {
  onCapture: (file: File) => void;
  onFallback: () => void;
  busy?: boolean;
}

const SAMPLE_WIDTH = 160;
const SAMPLE_HEIGHT = 120;

function measureFrame(canvas: HTMLCanvasElement): CameraMetrics | null {
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) {
    return null;
  }
  const { data, width, height } = context.getImageData(0, 0, canvas.width, canvas.height);
  const gray = new Float32Array(width * height);
  let sum = 0;
  for (let index = 0; index < gray.length; index += 1) {
    const offset = index * 4;
    const value = 0.299 * data[offset]! + 0.587 * data[offset + 1]! + 0.114 * data[offset + 2]!;
    gray[index] = value;
    sum += value;
  }

  let laplacianSum = 0;
  let laplacianSquareSum = 0;
  let count = 0;
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const center = gray[y * width + x]!;
      const laplacian =
        gray[(y - 1) * width + x]! +
        gray[(y + 1) * width + x]! +
        gray[y * width + (x - 1)]! +
        gray[y * width + (x + 1)]! -
        4 * center;
      laplacianSum += laplacian;
      laplacianSquareSum += laplacian * laplacian;
      count += 1;
    }
  }

  if (count === 0) {
    return null;
  }
  const mean = laplacianSum / count;
  const variance = laplacianSquareSum / count - mean * mean;
  return {
    brightness: sum / gray.length,
    sharpness: variance,
  };
}

function hintFor(metrics: CameraMetrics | null, status: CameraStatus): { text: string; tone: 'ok' | 'warn' | 'wait' } {
  if (status !== 'live' || !metrics) {
    return { text: 'Готовим камеру…', tone: 'wait' };
  }
  if (metrics.brightness < 60) {
    return { text: 'Темно: включите свет или подойдите к окну', tone: 'warn' };
  }
  if (metrics.brightness > 245) {
    return { text: 'Слишком ярко: уберите лампу или блик из кадра', tone: 'warn' };
  }
  if (metrics.sharpness < 18) {
    return { text: 'Смазано: держите телефон неподвижно', tone: 'warn' };
  }
  return { text: 'Кадр хороший — снимайте', tone: 'ok' };
}

/**
 * Live camera with a translucent sheet frame and honest brightness/sharpness feedback, so a worker
 * does not have to guess whether the photo is readable.
 */
export function SmartCamera({ onCapture, onFallback, busy = false }: SmartCameraProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const sampleRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [status, setStatus] = useState<CameraStatus>('starting');
  const [metrics, setMetrics] = useState<CameraMetrics | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const media = typeof navigator !== 'undefined' ? navigator.mediaDevices : undefined;
    if (!media || typeof media.getUserMedia !== 'function') {
      setStatus('unsupported');
      setMessage('Браузер не поддерживает камеру. Загрузите фото или PDF кнопкой ниже.');
      return;
    }

    media
      .getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
      })
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;
        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          void video.play().catch(() => undefined);
        }
        setStatus('live');
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return;
        }
        setStatus('denied');
        setMessage(
          error instanceof DOMException && error.name === 'NotAllowedError'
            ? 'Нет доступа к камере: разрешите съёмку в настройках браузера.'
            : 'Камера недоступна на этом устройстве.',
        );
      });

    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (status !== 'live') {
      return;
    }
    const timer = window.setInterval(() => {
      const video = videoRef.current;
      if (!video || video.videoWidth === 0) {
        return;
      }
      let canvas = sampleRef.current;
      if (!canvas) {
        canvas = document.createElement('canvas');
        canvas.width = SAMPLE_WIDTH;
        canvas.height = SAMPLE_HEIGHT;
        sampleRef.current = canvas;
      }
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) {
        return;
      }
      context.drawImage(video, 0, 0, SAMPLE_WIDTH, SAMPLE_HEIGHT);
      const next = measureFrame(canvas);
      if (next) {
        setMetrics(next);
      }
    }, 400);
    return () => window.clearInterval(timer);
  }, [status]);

  const capture = useCallback(() => {
    const video = videoRef.current;
    if (!video || video.videoWidth === 0) {
      return;
    }
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext('2d');
    if (!context) {
      return;
    }
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          return;
        }
        const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
        onCapture(new File([blob], `scan-${stamp}.jpg`, { type: 'image/jpeg' }));
      },
      'image/jpeg',
      0.92,
    );
  }, [onCapture]);

  const hint = hintFor(metrics, status);

  return (
    <div className="camera">
      <div className={`camera-viewport ${status === 'live' ? 'is-live' : 'is-idle'}`}>
        <video ref={videoRef} className="camera-video" playsInline muted autoPlay aria-label="Видео с камеры" />
        <div className="camera-frame" aria-hidden="true">
          <span className="camera-corner corner-tl" />
          <span className="camera-corner corner-tr" />
          <span className="camera-corner corner-bl" />
          <span className="camera-corner corner-br" />
        </div>
        {status !== 'live' ? (
          <div className="camera-placeholder">
            <span className="camera-placeholder-icon" aria-hidden="true">📷</span>
            <p>{message ?? 'Включаем камеру…'}</p>
          </div>
        ) : null}
        <span className="camera-frame-caption">Совместите лист с рамкой</span>
      </div>

      <div className={`camera-meter camera-meter-${hint.tone}`} role="status">
        <span className="camera-dot" aria-hidden="true" />
        <span className="camera-hint">{hint.text}</span>
        {metrics ? (
          <span className="camera-numbers" aria-hidden="true">
            {Math.round(metrics.brightness)} / {Math.round(metrics.sharpness)}
          </span>
        ) : null}
      </div>

      <div className="camera-actions">
        <button type="button" className="btn btn-primary camera-shutter" onClick={capture} disabled={status !== 'live' || busy}>
          Снять кадр
        </button>
        <button type="button" className="btn btn-ghost" onClick={onFallback}>
          Загрузить файл вместо камеры
        </button>
      </div>
      <p className="muted small camera-tip">
        Лист целиком в рамке, без пальцев и блика. Вертикальные размеры читаются автоматически — держите чертёж
        как удобно.
      </p>
    </div>
  );
}
