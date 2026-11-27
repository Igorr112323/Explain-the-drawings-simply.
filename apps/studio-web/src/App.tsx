/**
 * IkGuide Studio: белый холст с точечной сеткой и пятью парящими капсулами.
 *
 * Один сценарий без обучения: перетащили 2D-чертёж или PDF → на холсте легли листы A4 будущего
 * PDF → нажали `↑` и сохранили файл. Всё остальное живёт в поповерах, которые вырастают из своей
 * капсулы и закрываются кликом мимо.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { PlanTarget } from '@ikguide/pdf-exporter';
import { ACCEPT_ATTRIBUTE, type DemoId } from './lib/pipeline';
import { usePipeline } from './state/pipeline';
import { applyTheme, initialTheme, type Theme } from './lib/theme';
import { pickDrawingFile } from './lib/nativeOpen';
import { saveLabel } from './lib/nativeExport';
import { ErrorStage, HintStage, WorkingStage } from './components/Stages';
import { ReviewStage } from './components/ReviewStage';
import { TextPanel } from './components/TextPanel';
import { XrayPanel } from './components/XrayPanel';
import { NotePanel } from './components/NotePanel';
import { DemosMenu } from './components/DemosMenu';
import { MoreMenu } from './components/MoreMenu';
import { Pill, PillButton, Popover, RoundButton } from './components/Pill';
import {
  IconAttach,
  IconBack,
  IconCompose,
  IconExport,
  IconMore,
  IconStack,
  IconText,
  IconUndo,
  IconXray,
} from './components/icons';

type PanelId = 'text' | 'xray' | 'note' | 'more' | 'demos' | null;

export function App() {
  const api = usePipeline();
  const [panel, setPanel] = useState<PanelId>(null);
  const [focusStepId, setFocusStepId] = useState<string | null>(null);
  const [selectedNotation, setSelectedNotation] = useState<string | null>(null);
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const inReview = api.stage === 'review';
  const hasDoc = Boolean(api.doc);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  useEffect(() => {
    if (api.stage !== 'review') {
      setPanel(null);
      setFocusStepId(null);
    }
  }, [api.stage]);

  const close = useCallback(() => setPanel(null), []);
  const toggle = (id: Exclude<PanelId, null>) => setPanel((prev) => (prev === id ? null : id));

  const openFiles = (files: FileList | File[] | null | undefined) => {
    const list = files ? Array.from(files) : [];
    if (list.length === 0) {
      return;
    }
    setPanel(null);
    void api.actions.start(list);
  };

  const openExample = (id: DemoId) => {
    setPanel(null);
    void api.actions.openExample(id);
  };

  /** Скрепка: в `.exe` — системный проводник, в браузере — обычное поле выбора файла. */
  const pickFile = async () => {
    const native = await pickDrawingFile();
    if (native) {
      openFiles([native]);
      return;
    }
    inputRef.current?.click();
  };

  /** Клик по листу A4: открываем ту панель, где правится именно это поле. */
  const onTarget = (target: PlanTarget) => {
    switch (target.type) {
      case 'title':
        setFocusStepId(null);
        setPanel('text');
        break;
      case 'step-title':
      case 'step-text':
        setFocusStepId(target.stepId);
        setPanel('text');
        break;
      case 'step-anti':
        setFocusStepId(target.stepId);
        setPanel('note');
        break;
      case 'step-illustration':
        setPanel('xray');
        break;
      case 'notation':
        setSelectedNotation(target.annotationId);
        setPanel('xray');
        break;
    }
  };

  const indicator = api.ambiguous.length > 0 || api.softNotes.length > 0;

  return (
    <div
      className="canvas"
      data-dragging={dragging ? 'true' : 'false'}
      data-stage={api.stage}
      onDragOver={(event) => {
        event.preventDefault();
        if (!dragging) {
          setDragging(true);
        }
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setDragging(false);
        }
      }}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        openFiles(event.dataTransfer?.files);
      }}
    >
      {/* Верхний левый угол: назад к чистому холсту. */}
      <div className="slot slot-tl">
        <RoundButton
          size={44}
          label={hasDoc || inReview ? 'Назад к чистому холсту' : 'Назад — пока некуда: файл ещё не открыт'}
          disabled={api.stage === 'upload'}
          onClick={() => {
            setPanel(null);
            api.actions.reset();
          }}
        >
          <IconBack />
        </RoundButton>
      </div>

      {/* Верхний правый угол: отмена, экспорт PDF, меню. */}
      <div className="slot slot-tr">
        <Pill>
          <PillButton label="Отменить последнее действие" onClick={api.actions.undo} disabled={!api.canUndo}>
            <IconUndo />
          </PillButton>
          <PillButton
            label={api.pdfBusy ? 'Собираем PDF…' : saveLabel()}
            onClick={() => void api.actions.download()}
            disabled={!inReview || api.pdfBusy}
          >
            <IconExport />
          </PillButton>
          <PillButton
            label="Ещё: тема, движок, адреса сервисов"
            onClick={() => toggle('more')}
            active={panel === 'more'}
            expanded={panel === 'more'}
            trigger
          >
            <IconMore />
          </PillButton>
        </Pill>
        {panel === 'more' && (
          <Popover title="Ещё" placement="below" align="end" width={420} onClose={close}>
            <MoreMenu theme={theme} onTheme={setTheme} />
          </Popover>
        )}
      </div>

      {/* Нижний левый угол: примеры чертежей. */}
      <div className="slot slot-bl">
        <RoundButton
          label="Примеры чертежей"
          onClick={() => toggle('demos')}
          active={panel === 'demos'}
          trigger
        >
          <IconStack />
        </RoundButton>
        {panel === 'demos' && (
          <Popover title="Примеры чертежей" placement="above" align="start" width={380} onClose={close}>
            <DemosMenu onDemo={openExample} />
          </Popover>
        )}
      </div>

      {/* Нижний центр: правка текста, рентген ГОСТ, загрузка файла. */}
      <div className="slot slot-bc">
        <Pill>
          <PillButton
            label="Править текст и название"
            onClick={() => toggle('text')}
            active={panel === 'text'}
            expanded={panel === 'text'}
            disabled={!hasDoc}
            trigger
          >
            <IconText />
          </PillButton>
          <PillButton
            label="Рентген ГОСТ и допуски"
            onClick={() => toggle('xray')}
            active={panel === 'xray'}
            expanded={panel === 'xray'}
            indicator={indicator}
            disabled={!hasDoc}
            trigger
          >
            <IconXray />
          </PillButton>
          <PillButton label="Загрузить 2D-чертёж или PDF" onClick={() => void pickFile()}>
            <IconAttach />
          </PillButton>
        </Pill>

        {panel === 'text' && hasDoc && (
          <Popover title="Текст и название" placement="above" align="center" width={460} onClose={close}>
            <TextPanel api={api} focusStepId={focusStepId} />
          </Popover>
        )}
        {panel === 'xray' && hasDoc && (
          <Popover title="Рентген ГОСТ и допуски" placement="above" align="center" width={470} onClose={close}>
            <XrayPanel api={api} selectedId={selectedNotation} onSelect={setSelectedNotation} />
          </Popover>
        )}
      </div>

      {/* Нижний правый угол: пометка «Осторожно!». */}
      <div className="slot slot-br">
        <RoundButton
          label="Добавить пометку «Осторожно!»"
          onClick={() => toggle('note')}
          active={panel === 'note'}
          disabled={!hasDoc}
          trigger
        >
          <IconCompose />
        </RoundButton>
        {panel === 'note' && hasDoc && (
          <Popover title="Пометка шага" placement="above" align="end" width={420} onClose={close}>
            <NotePanel api={api} focusStepId={focusStepId} />
          </Popover>
        )}
      </div>

      <main className="stage">
        {api.stage === 'upload' && <HintStage onDemos={() => toggle('demos')} dragging={dragging} />}
        {api.stage === 'working' && (
          <WorkingStage label={api.progress} percent={api.percent} files={api.files} />
        )}
        {api.stage === 'error' && api.error && (
          <ErrorStage
            message={api.error.message}
            hint={api.error.hint}
            onRetry={api.actions.reset}
            onDemo={openExample}
          />
        )}
        {inReview && <ReviewStage api={api} onTarget={onTarget} onOpenXray={() => setPanel('xray')} />}
      </main>

      <input
        ref={inputRef}
        className="visually-hidden"
        type="file"
        multiple
        accept={ACCEPT_ATTRIBUTE}
        aria-label="Файл 2D-чертежа или PDF"
        onChange={(event) => {
          openFiles(event.target.files);
          event.target.value = '';
        }}
      />
    </div>
  );
}
