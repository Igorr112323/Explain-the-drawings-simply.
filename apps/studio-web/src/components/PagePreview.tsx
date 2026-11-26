/**
 * Лист A4 будущего PDF прямо на холсте — «как в файле».
 *
 * Блоки плана — те же самые, что получает jsPDF: координаты в миллиметрах, кегль в пунктах.
 * Поэтому лист рисуется реального размера 210×297 мм и масштабируется целиком через `transform`,
 * а не пересчитывается в пиксели по частям. Итог: переносы строк и отступы совпадают с PDF, а клик
 * по названию, тексту шага или схеме открывает правку ровно того поля, что напечатано.
 */
import { PAGE, type PlanBlock, type PlanPage, type PlanTarget } from '@ikguide/pdf-exporter';

/** Пикселей в миллиметре при 96 dpi — так лист на экране того же размера, что и на бумаге. */
const PX_PER_MM = 3.7795;

const blockTarget = (block: PlanBlock): PlanTarget | undefined =>
  'target' in block ? (block.target as PlanTarget | undefined) : undefined;

function TextBlock({ block, onTarget }: { block: Extract<PlanBlock, { kind: 'text' }>; onTarget?: (target: PlanTarget) => void }) {
  const target = blockTarget(block);
  const style = {
    left: `${block.x}mm`,
    top: `${block.y}mm`,
    width: `${block.w}mm`,
    fontSize: `${block.size}pt`,
    lineHeight: 1.28,
    color: block.color,
    textAlign: block.align,
  } as const;
  const body = block.lines.map((line, index) => (
    <span key={`${block.y}-${index}`} className="pv-line">
      {line || '\u00a0'}
    </span>
  ));

  if (!target || !onTarget) {
    return <div className={`pv-text pv-weight-${block.weight}`} style={style}>{body}</div>;
  }
  return (
    <button
      type="button"
      className={`pv-text pv-weight-${block.weight} pv-editable`}
      style={style}
      onClick={() => onTarget(target)}
      title="Изменить на листе"
      aria-label={`Изменить: ${block.lines.join(' ').slice(0, 60)}`}
    >
      {body}
    </button>
  );
}

function Block({ block, onTarget }: { block: PlanBlock; onTarget?: (target: PlanTarget) => void }) {
  if (block.kind === 'text') {
    return <TextBlock block={block} onTarget={onTarget} />;
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

  const target = blockTarget(block);
  const frame = {
    left: `${block.x}mm`,
    top: `${block.y}mm`,
    width: `${block.w}mm`,
    height: `${block.h}mm`,
  } as const;

  return (
    <>
      {block.kind === 'svg' ? (
        <div
          className="pv-svg"
          style={frame}
          // Разметку строит собственный детерминированный SVG-рендерер (`ikeaSvg`/art), не пользователь.
          dangerouslySetInnerHTML={{ __html: block.markup }}
        />
      ) : (
        <img className="pv-image" src={block.dataUrl} alt="" style={frame} />
      )}
      {target && onTarget && (
        <button
          type="button"
          className="pv-overlay"
          style={frame}
          onClick={() => onTarget(target)}
          title="Изменить схему"
          aria-label="Изменить схему на листе"
        />
      )}
    </>
  );
}

export function PagePreview({
  page,
  total,
  scale,
  onTarget,
}: {
  page: PlanPage;
  total: number;
  scale: number;
  onTarget?: (target: PlanTarget) => void;
}) {
  return (
    <figure className="page-figure" aria-label={`Страница ${page.index} из ${total}`}>
      <div
        className="page-frame"
        style={{ width: `${PAGE.width * PX_PER_MM * scale}px`, height: `${PAGE.height * PX_PER_MM * scale}px` }}
      >
        <div className="page" style={{ transform: `scale(${scale})` }}>
          {page.blocks.map((block, index) => (
            <Block key={`${page.index}-${index}-${block.kind}`} block={block} onTarget={onTarget} />
          ))}
        </div>
      </div>
      {/* `PlanPage.index` уже нумеруется с единицы — прибавлять ничего не нужно. */}
      <figcaption className="page-caption">
        Стр. {page.index} из {total}
      </figcaption>
    </figure>
  );
}
