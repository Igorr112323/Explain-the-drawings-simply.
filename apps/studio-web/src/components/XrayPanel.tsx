/**
 * Поповер «Рентген ГОСТ / Допуски».
 *
 * Сверху — быстрая проверка любого шифра: набираете «Ø20 H7» и сразу видите расшифровку из того же
 * `gost-translator`, что собирает шпаргалку PDF. Ниже — лист чертежа с пинами распознанных
 * обозначений и список: автоперевод можно переписать, правка уйдёт в PDF.
 */
import { useEffect, useMemo, useState } from 'react';
import type { XrayAnnotation } from '@ikguide/schema';
import { translateEngineeringNotation } from '@ikguide/gost-translator';
import type { PipelineApi } from '../state/pipeline';
import { InlineEdit } from './InlineEdit';
import { SheetCard } from './SheetCard';

export function XrayPanel({
  api,
  selectedId,
  onSelect,
}: {
  api: PipelineApi;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const doc = api.doc!;
  const [query, setQuery] = useState('');
  const lookup = useMemo(() => (query.trim() ? translateEngineeringNotation(query) : null), [query]);
  const lookupWarnings = lookup && 'warnings' in lookup ? (lookup.warnings as string[]) : [];

  // Клик по пину на листе открывает панель — сразу показываем ту же строку в списке.
  useEffect(() => {
    if (!selectedId) {
      return;
    }
    const row = document.querySelector(`[data-annotation="${selectedId}"]`);
    row?.scrollIntoView?.({ block: 'nearest' });
  }, [selectedId]);

  return (
    <div className="panel">
      <section className="panel-section">
        <label className="field">
          <span className="field-label">Проверить обозначение</span>
          <input
            type="text"
            className="lookup"
            value={query}
            placeholder="Ø20 H7 · М8-7H · 2×45° · Ra 3,2"
            aria-label="Проверить обозначение по ГОСТ"
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        {lookup && (
          <div className="lookup-out" role="status">
            <p className="lookup-explanation">{lookup.explanation}</p>
            {lookupWarnings.map((warning) => (
              <p key={warning} className="lookup-warning">
                {warning}
              </p>
            ))}
          </div>
        )}
      </section>

      <SheetCard pages={api.pages} annotations={doc.xrayAnnotations} selectedId={selectedId} onPick={onSelect} />

      {doc.xrayAnnotations.length === 0 ? (
        <p className="panel-note">В этом документе нет распознанных обозначений: все размеры уже в тексте шагов.</p>
      ) : (
        <>
          <h3 className="panel-h">Обозначения и допуски · {doc.xrayAnnotations.length}</h3>
          <ul className="notation-list">
            {doc.xrayAnnotations.map((annotation) => (
              <NotationRow
                key={annotation.id}
                annotation={annotation}
                active={selectedId === annotation.id}
                onNote={(note) => api.actions.editAnnotationNote(annotation.id, note)}
                onConfirm={(value) => api.actions.resolveSize(annotation.id, value)}
                onPick={() => onSelect(annotation.id)}
              />
            ))}
          </ul>
        </>
      )}

      {api.warnings.length > 0 && (
        <details className="warnings">
          <summary>Замечания распознавания ({api.warnings.length})</summary>
          <ul>
            {api.warnings.map((warning, index) => (
              <li key={index}>{warning}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function NotationRow({
  annotation,
  active,
  onNote,
  onConfirm,
  onPick,
}: {
  annotation: XrayAnnotation;
  active: boolean;
  onNote: (note: string) => void;
  onConfirm: (value: string) => void;
  onPick: () => void;
}) {
  const raw = annotation.resolvedValue ?? annotation.raw;
  const auto = translateEngineeringNotation(raw).explanation;
  const unsure = annotation.confidence < 0.95;

  return (
    <li className={`notation ${active ? 'notation-active' : ''}`} data-annotation={annotation.id}>
      <button type="button" className="notation-head" onClick={onPick} title="Показать на листе чертежа">
        <code className="notation-raw">{raw}</code>
        {unsure && (
          <span className="notation-flag" title={`Уверенность ${Math.round(annotation.confidence * 100)}%`}>
            {Math.round(annotation.confidence * 100)}%
          </span>
        )}
        {!annotation.confirmedByHuman && (
          <span
            className="chip chip-confirm"
            role="button"
            tabIndex={0}
            onClick={(event) => {
              event.stopPropagation();
              onConfirm(raw);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                onConfirm(raw);
              }
            }}
            title="Подтвердить обозначение по чертежу"
          >
            подтвердить
          </span>
        )}
      </button>
      <p className="notation-auto">{auto}</p>
      <InlineEdit
        value={annotation.note ?? ''}
        placeholder="Своя расшифровка (необязательно)"
        ariaLabel={`Расшифровка ${annotation.raw}`}
        className="notation-note"
        multiline
        onCommit={onNote}
      />
    </li>
  );
}
