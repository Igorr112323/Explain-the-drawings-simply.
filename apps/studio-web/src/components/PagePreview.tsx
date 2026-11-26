/**
 * Живой предпросмотр листа A4 «как в файле».
 *
 * Блоки плана — те же самые, что получает jsPDF: координаты в миллиметрах, кегль в пунктах.
 * Поэтому лист рисуется реального размера 210×297 мм и масштабируется целиком через `transform`,
 * а не пересчитывается в пиксели по частям. Итог: переносы строк и отступы совпадают с PDF.
 */
import { useEffect, useRef, useState } from 'react';
import { PAGE, type PlanBlock, type PlanPage } from '@ikguide/pdf-exporter';

const MIN_SCALE = 0.32;
const MAX_SCALE = 1;
const FALLBACK_WIDTH = 700;

function Block({ block }: { block: PlanBlock }) {
  if (block.kind === 'text') {
    return (
      <div
        className={`pv-text pv-weight-${block.weight}`}
        style={{
          left: `${block.x}mm`,
          top: `${block.y}mm`,
          width: `${block.w}mm`,
          fontSize: `${block.size}pt`,
          lineHeight: 1.28,
          color: block.color,
          textAlign: block.align,
        }}
      >
        {block.lines.map((line, index) => (
          <div key={`${block.y}-${index}`} className="pv-line">
            {line || '\u00a0'}
          </div>
        ))}
      </div>
    );
  }
  if (block.kind === 'rect') {
    return (
      <div
        className="pv-rect"
        style={{
          left: `${block.x}mm`,
          top: `${block.y}mm`,
          width: `${block.w}mm`,
          height: `${block.h}mm`,
          borderRadius: `${block.radius}mm`,
          background: block.fill ?? 'transparent',
          border: block.stroke ? `${Math.max(block.lineWidth, 0.15)}mm solid ${block.stroke}` : 'none',
        }}
      />
    );
  }
  if (block.kind === 'line') {
    const horizontal = Math.abs(block.y2 - block.y1) < 0.05;
    return (
      <div
        className="pv-line-rule"
        style={{
          left: `${Math.min(block.x1, block.x2)}mm`,
          top: `${Math.min(block.y1, block.y2)}mm`,
          width: horizontal ? `${Math.abs(block.x2 - block.x1)}mm` : `${Math.max(block.lineWidth, 0.2)}mm`,
          height: horizontal ? `${Math.max(block.lineWidth, 0.2)}mm` : `${Math.abs(block.y2 - block.y1)}mm`,
          background: block.color,
        }}
      />
    );
  }
  if (block.kind === 'svg') {
    return (
      <div
        className="pv-svg"
        style={{ left: `${block.x}mm`, top: `${block.y}mm`, width: `${block.w}mm`, height: `${block.h}mm` }}
        // Разметку строит собственный детерминированный SVG-рендерер (`ikeaSvg`/art), не пользователь.
        dangerouslySetInnerHTML={{ __html: block.markup }}
      />
    );
  }
  return (
    <img
      className="pv-image"
      src={block.dataUrl}
      alt=""
      style={{ left: `${block.x}mm`, top: `${block.y}mm`, width: `${block.w}mm`, height: `${block.h}mm` }}
    />
  );
}

/** Ширина листа подстраивается под колонку, но в пределах читаемости. */
function useFitScale(reference: React.RefObject<HTMLDivElement>) {
  const [scale, setScale] = useState(0.78);

  useEffect(() => {
    const element = reference.current;
    if (!element) {
      return;
    }
    const measure = () => {
      const width = element.clientWidth || FALLBACK_WIDTH;
      const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, width / (PAGE.width * 3.7795)));
      setScale(next);
    };
    measure();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure);
      return () => window.removeEventListener('resize', measure);
    }
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [reference]);

  return scale;
}

export function PagePreview({
  page,
  total,
  title,
  scale: fixedScale,
}: {
  page: PlanPage;
  total: number;
  title: string;
  scale?: number;
}) {
  const host = useRef<HTMLDivElement>(null);
  const fitted = useFitScale(host);
  const scale = fixedScale ?? fitted;

  return (
    <figure className="page-figure">
      <div ref={host} className="page-slot" style={{ width: '100%' }}>
        <div
          className="page-frame"
          style={{ width: `${PAGE.width * 3.7795 * scale}px`, height: `${PAGE.height * 3.7795 * scale}px` }}
        >
          <div className="page" style={{ transform: `scale(${scale})` }}>
            {page.blocks.map((block, index) => (
              <Block key={`${page.index}-${index}-${block.kind}`} block={block} />
            ))}
          </div>
        </div>
      </div>
      <figcaption className="page-caption">
        Стр. {page.index + 1} из {total} · {title}
      </figcaption>
    </figure>
  );
}
