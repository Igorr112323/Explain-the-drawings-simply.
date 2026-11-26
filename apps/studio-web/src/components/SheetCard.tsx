import type { XrayAnnotation } from '@ikguide/schema';
import type { VisionPage } from '@ikguide/builder';

/**
 * Лист чертежа с пинами распознанных обозначений.
 *
 * Клик по пину выбирает обозначение: рядом с листом открывается его расшифровка, которую можно
 * переписать. Так «клик по значку → правка перевода» работает буквально по картинке, а не только
 * по списку. Показываем только листы, которые вернул сервис распознавания.
 */
export function SheetCard({
  pages,
  annotations,
  selectedId,
  onPick,
}: {
  pages: readonly VisionPage[];
  annotations: readonly XrayAnnotation[];
  selectedId: string | null;
  onPick: (id: string) => void;
}) {
  const page = pages.find((item) => item.imageDataUrl);
  if (!page?.imageDataUrl) {
    return null;
  }

  return (
    <section className="card">
      <h3>Лист чертежа</h3>
      <p className="card-note">
        Точки — распознанные обозначения. Нажмите на точку, чтобы исправить расшифровку: правка уйдёт
        в шпаргалку PDF.
      </p>
      <div className="sheet">
        <img src={page.imageDataUrl} alt={`Лист ${page.pageIndex + 1}: распознанные обозначения`} className="sheet-image" />
        {annotations.map((annotation) => (
          <button
            key={annotation.id}
            type="button"
            className={`sheet-pin ${annotation.confirmedByHuman ? 'sheet-pin-done' : ''} ${
              selectedId === annotation.id ? 'sheet-pin-active' : ''
            }`}
            style={{ left: `${annotation.xPercent}%`, top: `${annotation.yPercent}%` }}
            onClick={() => onPick(annotation.id)}
            title={`${annotation.raw} · ${Math.round(annotation.confidence * 100)}%`}
            aria-label={`Обозначение ${annotation.raw}, уверенность ${Math.round(annotation.confidence * 100)} процентов`}
          >
            <span className="sheet-pin-label">{annotation.raw}</span>
          </button>
        ))}
      </div>
    </section>
  );
}
