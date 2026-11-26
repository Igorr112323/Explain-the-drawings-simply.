import { useStudio } from '../../state/studio';
import { StepArt } from '../common/StepArt';

export function PrintSheet() {
  const { doc, stats } = useStudio();

  return (
    <div className="print-root" aria-hidden="true">
      <section className="print-page print-cover">
        <header className="print-brand">
          <span className="print-logo">IkGuide</span>
          <span className="print-brand-sub">чертёж → понятная инструкция</span>
        </header>

        <h1>{doc.metadata.title}</h1>
        <p className="print-code">
          {doc.metadata.drawingCode} · ревизия {doc.metadata.revision} · {doc.drawing.sheetFormat} · {doc.drawing.scale}
        </p>

        <dl className="print-facts">
          <div>
            <dt>Материал</dt>
            <dd>{doc.metadata.material}</dd>
          </div>
          <div>
            <dt>Заготовка</dt>
            <dd>{doc.metadata.blankDimensions}</dd>
          </div>
          <div>
            <dt>Масса</dt>
            <dd>{doc.metadata.massKg ? `${doc.metadata.massKg} кг` : '—'}</dd>
          </div>
          <div>
            <dt>Сложность</dt>
            <dd>{doc.metadata.difficulty}</dd>
          </div>
          <div>
            <dt>Время</dt>
            <dd>≈ {stats.totalMinutes} мин</dd>
          </div>
          <div>
            <dt>Автор</dt>
            <dd>{doc.metadata.author}</dd>
          </div>
        </dl>

        <h2>Комплектация и крепёж</h2>
        <table className="print-table">
          <thead>
            <tr>
              <th>№</th>
              <th>Наименование</th>
              <th>Типоразмер</th>
              <th>Кол-во</th>
              <th>Стандарт</th>
            </tr>
          </thead>
          <tbody>
            {doc.bom.map((item, index) => (
              <tr key={item.id}>
                <td>{index + 1}</td>
                <td>{item.name}</td>
                <td>{item.size}</td>
                <td>{item.quantity}</td>
                <td>{item.standard ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <h2>Инструмент</h2>
        <table className="print-table">
          <thead>
            <tr>
              <th>№</th>
              <th>Инструмент</th>
              <th>Размер</th>
              <th>Назначение</th>
            </tr>
          </thead>
          <tbody>
            {doc.tools.map((tool, index) => (
              <tr key={tool.id}>
                <td>{index + 1}</td>
                <td>{tool.name}</td>
                <td>{tool.size ?? '—'}</td>
                <td>{tool.purpose}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <p className="print-footnote">
          Инструкция сформирована IkGuide. Обозначения переведены детерминированным ГОСТ-переводчиком; размеры с
          уверенностью ниже 95 % подтверждены человеком.
        </p>
      </section>

      {doc.steps.map((step) => (
        <section className="print-page print-step" key={step.id}>
          <header className="print-step-head">
            <span>
              Шаг {step.number} из {doc.steps.length}
            </span>
            <span>{doc.metadata.drawingCode}</span>
          </header>

          <h2>{step.title}</h2>
          <div className="print-art">
            <StepArt illustration={step.illustration} />
          </div>
          <p className="print-text">{step.workerText}</p>

          {step.criticalChecks.length > 0 ? (
            <table className="print-table print-checks">
              <thead>
                <tr>
                  <th>Контроль</th>
                  <th>Номинал</th>
                  <th>Критерий приёмки</th>
                  <th>Инструмент</th>
                </tr>
              </thead>
              <tbody>
                {step.criticalChecks.map((check) => (
                  <tr key={check.id}>
                    <td>{check.label}</td>
                    <td>
                      <strong>{check.nominal}</strong>
                    </td>
                    <td>{check.acceptance}</td>
                    <td>{check.instrument}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}

          {step.antiError ? (
            <div className="print-anti">
              <strong>Анти-ошибка</strong>
              <p>{step.antiError.text}</p>
            </div>
          ) : null}

          <footer className="print-page-foot">
            IkGuide · {doc.metadata.title} · шаг {step.number}
          </footer>
        </section>
      ))}

      <section className="print-page print-qc">
        <h1>Проверь перед сдачей</h1>
        <p className="print-code">{doc.metadata.drawingCode}</p>
        <ul className="print-qc-list">
          {doc.qcChecklist.map((item) => (
            <li key={item.id}>
              <span className="print-checkbox" />
              <span>
                {item.text}
                {item.reference ? <em> ({item.reference})</em> : null}
              </span>
            </li>
          ))}
        </ul>
        <div className="print-sign">
          <div>
            <span>Рабочий</span>
            <span className="print-line" />
          </div>
          <div>
            <span>ОТК</span>
            <span className="print-line" />
          </div>
        </div>
      </section>
    </div>
  );
}
