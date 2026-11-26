/**
 * Поповер «Примеры чертежей» из нижнего левого угла: три встроенных документа, которые
 * открываются мгновенно и без сети — чтобы увидеть результат, даже если движок не запущен.
 */
import { DEMO_PROJECTS } from '../data/demos';
import type { DemoId } from '../lib/pipeline';

export function DemosMenu({ onDemo }: { onDemo: (id: DemoId) => void }) {
  return (
    <div className="panel">
      <ul className="demo-list">
        {DEMO_PROJECTS.map((demo) => (
          <li key={demo.id}>
            <button type="button" className="demo-item" onClick={() => onDemo(demo.id)}>
              <span className="demo-tag">{demo.tag}</span>
              <span className="demo-text">
                <span className="demo-title">{demo.title}</span>
                <span className="demo-note">{demo.note}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      <p className="panel-note">Примеры встроены в приложение: их можно открыть и без движка.</p>
    </div>
  );
}
