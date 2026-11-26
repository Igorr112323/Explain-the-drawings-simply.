interface EngineerToolbarProps {
  scale: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onResetView: () => void;
  onImport: () => void;
  onExport: () => void;
  onQr: () => void;
  onPrint: () => void;
  onAddStep: () => void;
  onPreviewWorker: () => void;
}

export function EngineerToolbar({
  scale,
  onZoomIn,
  onZoomOut,
  onResetView,
  onImport,
  onExport,
  onQr,
  onPrint,
  onAddStep,
  onPreviewWorker,
}: EngineerToolbarProps) {
  return (
    <div className="engineer-toolbar">
      <div className="capsule toolbar-group">
        <button type="button" className="toolbar-button" onClick={onAddStep}>
          <span aria-hidden="true">＋</span> Шаг
        </button>
        <button type="button" className="toolbar-button" onClick={onImport}>
          <span aria-hidden="true">↧</span> Импорт
        </button>
        <button type="button" className="toolbar-button" onClick={onExport}>
          <span aria-hidden="true">↥</span> Экспорт
        </button>
        <button type="button" className="toolbar-button" onClick={onQr}>
          <span aria-hidden="true">▦</span> QR
        </button>
        <button type="button" className="toolbar-button" onClick={onPrint}>
          <span aria-hidden="true">🖨</span> Печать / PDF
        </button>
      </div>

      <div className="capsule toolbar-group">
        <button type="button" className="toolbar-icon" onClick={onZoomOut} aria-label="Уменьшить масштаб">
          −
        </button>
        <button type="button" className="toolbar-scale" onClick={onResetView} title="Сбросить масштаб">
          {Math.round(scale * 100)} %
        </button>
        <button type="button" className="toolbar-icon" onClick={onZoomIn} aria-label="Увеличить масштаб">
          +
        </button>
        <button type="button" className="toolbar-button" onClick={onResetView}>
          Сброс
        </button>
      </div>

      <div className="capsule toolbar-group">
        <button type="button" className="toolbar-button toolbar-primary" onClick={onPreviewWorker}>
          Глазами рабочего →
        </button>
      </div>
    </div>
  );
}
