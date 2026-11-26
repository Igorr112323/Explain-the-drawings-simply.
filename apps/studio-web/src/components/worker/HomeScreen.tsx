import { useState } from 'react';
import { documentStats, parseDocumentJson, type IkGuideDocument } from '@ikguide/schema';
import { useStudio } from '../../state/studio';
import { readTextFile } from '../../lib/download';
import { WorkerHeader, SectionTitle } from './WorkerChrome';
import { QrDialog } from '../common/QrDialog';
import { BomGlyph } from '../common/Glyphs';

export function HomeScreen() {
  const { state, dispatch, doc, stats, unconfirmed } = useStudio();
  const [qrOpen, setQrOpen] = useState(false);

  const openDoc = (item: IkGuideDocument, screen: 'prep' | 'xray') => {
    dispatch({ type: 'SELECT_DOC', docId: item.id });
    dispatch({ type: 'SET_SCREEN', screen });
  };


  const handleGuideFile = async (file: File) => {
    try {
      const text = await readTextFile(file);
      const imported = parseDocumentJson(text);
      dispatch({ type: 'IMPORT_DOC', doc: imported });
      dispatch({ type: 'SHOW_TOAST', tone: 'success', text: `Инструкция «${imported.metadata.title}» импортирована.` });
    } catch (error) {
      dispatch({
        type: 'SHOW_TOAST',
        tone: 'danger',
        text: error instanceof Error ? error.message : 'Файл инструкции не прошёл проверку',
      });
    }
  };

  const onFilePicked = async (file: File | undefined) => {
    if (!file) {
      return;
    }
    const isGuide = file.type === 'application/json' || /\.json$/i.test(file.name);
    if (isGuide) {
      await handleGuideFile(file);
      return;
    }
    dispatch({ type: 'OPEN_SCAN', mode: 'files', files: [file] });
  };

  return (
    <div className="screen screen-home">
      <WorkerHeader title="Мои инструкции" subtitle="Чертёж → понятная инструкция за пару минут" />

      <SectionTitle>Недавние</SectionTitle>
      <div className="doc-cards">
        {state.docs.map((item) => {
          const itemStats = documentStats(item);
          const isActive = item.id === doc.id;
          return (
            <article key={item.id} className={`doc-card ${isActive ? 'is-active' : ''}`}>
              <div className="doc-card-top">
                <span className="doc-code">{item.metadata.drawingCode}</span>
                {itemStats.unconfirmedCount > 0 ? (
                  <span className="badge badge-warning">{itemStats.unconfirmedCount} проверить</span>
                ) : (
                  <span className="badge badge-success">готово</span>
                )}
              </div>
              <h2>{item.metadata.title}</h2>
              <p className="doc-meta">
                {item.metadata.material} · {item.metadata.blankDimensions}
              </p>
              <div className="doc-stats">
                <span>{itemStats.stepCount} шагов</span>
                <span>≈ {itemStats.totalMinutes} мин</span>
                <span>{itemStats.bomLineCount} позиций</span>
                <span className={`difficulty difficulty-${item.metadata.difficulty}`}>{difficultyLabel(item.metadata.difficulty)}</span>
              </div>
              <div className="doc-actions">
                <button type="button" className="btn btn-primary" onClick={() => openDoc(item, 'prep')}>
                  Открыть
                </button>
                <button type="button" className="btn btn-ghost" onClick={() => openDoc(item, 'xray')}>
                  Рентген
                </button>
              </div>
            </article>
          );
        })}
      </div>

      <SectionTitle>Быстрый доступ</SectionTitle>
      <div className="quick-grid">
        <button
          type="button"
          className="quick-card quick-warning"
          onClick={() => dispatch({ type: 'SET_SCREEN', screen: 'verify' })}
        >
          <span className="quick-icon">⚡</span>
          <span className="quick-label">Проверка размеров</span>
          <span className="quick-hint">{stats.unconfirmedCount > 0 ? `${unconfirmed.length} требуют подтверждения` : 'всё подтверждено'}</span>
        </button>
        <button type="button" className="quick-card" onClick={() => dispatch({ type: 'SET_SCREEN', screen: 'steps' })}>
          <span className="quick-icon">🍀</span>
          <span className="quick-label">Шаги инструкции</span>
          <span className="quick-hint">шаг {state.stepIndex + 1} из {stats.stepCount}</span>
        </button>
        <button type="button" className="quick-card" onClick={() => dispatch({ type: 'SET_SCREEN', screen: 'xray' })}>
          <span className="quick-icon">🔍</span>
          <span className="quick-label">Рентген чертежа</span>
          <span className="quick-hint">ГОСТ на человеческий</span>
        </button>
        <button type="button" className="quick-card" onClick={() => dispatch({ type: 'SET_SCREEN', screen: 'qc' })}>
          <span className="quick-icon">✅</span>
          <span className="quick-label">Чек-лист ОТК</span>
          <span className="quick-hint">контроль перед сдачей</span>
        </button>
      </div>

      <SectionTitle>Комплектация текущей инструкции</SectionTitle>
      <ul className="mini-bom">
        {doc.bom.slice(0, 4).map((item) => (
          <li key={item.id}>
            <span className="mini-bom-icon">
              <BomGlyph icon={item.icon} />
            </span>
            <span className="mini-bom-name">{item.name}</span>
            <span className="mini-bom-size">{item.size}</span>
            <span className="mini-bom-qty">×{item.quantity}</span>
          </li>
        ))}
      </ul>

      <div className="home-capsule">
        <button
          type="button"
          className="capsule-action capsule-primary"
          onClick={() => dispatch({ type: 'OPEN_SCAN', mode: 'camera' })}
        >
          📷 Сфоткать
        </button>
        <button
          type="button"
          className="capsule-action"
          onClick={() => dispatch({ type: 'OPEN_SCAN', mode: 'files' })}
        >
          📎 Загрузить
        </button>
        <button type="button" className="capsule-action" onClick={() => setQrOpen(true)}>
          ▦ QR-код
        </button>
        <label className="capsule-action capsule-file">
          ↧ Инструкция
          <input
            type="file"
            accept=".json,application/json"
            hidden
            onChange={(event) => {
              void onFilePicked(event.target.files?.[0]);
              event.target.value = '';
            }}
          />
        </label>
      </div>

      {qrOpen ? <QrDialog doc={doc} onClose={() => setQrOpen(false)} /> : null}
    </div>
  );
}

function difficultyLabel(difficulty: IkGuideDocument['metadata']['difficulty']): string {
  switch (difficulty) {
    case 'easy':
      return 'простая';
    case 'medium':
      return 'средняя';
    case 'hard':
      return 'сложная';
    case 'expert':
      return 'высокая';
    default:
      return difficulty;
  }
}
