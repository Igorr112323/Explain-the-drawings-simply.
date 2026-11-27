/**
 * Одно состояние на всё приложение: файл → документ → правки → PDF.
 *
 * Хук намеренно маленький: вся логика работы с файлами лежит в `lib/pipeline`, правки документа —
 * в `lib/fixes`, вёрстка — в `lib/pdfExport`. Здесь только оркестрация и то, что видит React.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { IkGuideDocument } from '@ikguide/schema';
import type { VisionPage } from '@ikguide/builder';
import {
  importFiles,
  openDemo,
  PipelineError,
  type DemoId,
  type PipelineResult,
  type PipelineSource,
  type ProgressReporter,
} from '../lib/pipeline';
import {
  ambiguousSizes,
  applyDimensionFix,
  lowConfidenceNotes,
  setAntiError,
  setAnnotationNote,
  setChecklistText,
  setMeta,
  setStepText,
  setStepTitle,
  setTitle,
  toggleChecklistRequired,
  type AmbiguousSize,
} from '../lib/fixes';
import { buildIllustrations, type Illustrations } from '../lib/illustrations';
import { renderPdf, type PdfJob } from '../lib/pdfExport';
import { downloadPdf } from '../lib/pdfExport';

export type Stage = 'upload' | 'working' | 'error' | 'review';

export interface PipelineState {
  stage: Stage;
  /** Текст прогресса на экране загрузки. */
  progress: string;
  /** 0…1 — полоса прогресса. */
  percent: number;
  doc: IkGuideDocument | null;
  pages: VisionPage[];
  fragments: Record<string, string>;
  coverFragment: string | null;
  source: PipelineSource | null;
  warnings: string[];
  files: string[];
  error: { message: string; hint: string } | null;
  pdfBusy: boolean;
  pdfJob: PdfJob | null;
  /** Снимки документа до каждой правки: по ним работает кнопка «Отменить». */
  history: IkGuideDocument[];
}

/** Сколько шагов правки помним: больше не нужно, а память не бесконечная. */
const HISTORY_LIMIT = 40;

const INITIAL: PipelineState = {
  stage: 'upload',
  progress: '',
  percent: 0,
  doc: null,
  pages: [],
  fragments: {},
  coverFragment: null,
  source: null,
  warnings: [],
  files: [],
  error: null,
  pdfBusy: false,
  pdfJob: null,
  history: [],
};

const PHASE_PERCENT = { reading: 0.12, recognizing: 0.4, building: 0.72, ready: 0.92 } as const;

export interface PipelineActions {
  start(files: File[]): Promise<void>;
  openExample(id: DemoId): Promise<void>;
  reset(): void;
  editTitle(title: string): void;
  editMeta(patch: { material?: string; drawingCode?: string }): void;
  editStepText(stepId: string, text: string): void;
  editStepTitle(stepId: string, title: string): void;
  editAntiError(stepId: string, text: string | null): void;
  resolveSize(annotationId: string, value: string): void;
  editAnnotationNote(annotationId: string, note: string): void;
  editChecklistText(itemId: string, text: string): void;
  toggleChecklistItem(itemId: string): void;
  undo(): void;
  download(): Promise<void>;
}

export interface PipelineApi extends PipelineState {
  illustrations: Illustrations;
  ambiguous: AmbiguousSize[];
  softNotes: AmbiguousSize[];
  /** Есть ли что отменять. */
  canUndo: boolean;
  actions: PipelineActions;
}

export function usePipeline(): PipelineApi {
  const [state, setState] = useState<PipelineState>(INITIAL);
  const mounted = useRef(true);
  const docRef = useRef<IkGuideDocument | null>(null);
  const stateRef = useRef(state);

  useEffect(() => {
    docRef.current = state.doc;
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const report: ProgressReporter = useCallback((phase, detail) => {
    if (!mounted.current) {
      return;
    }
    setState((prev) => ({
      ...prev,
      stage: 'working',
      progress: detail ?? prev.progress,
      percent: Math.max(prev.percent, PHASE_PERCENT[phase]),
    }));
  }, []);

  const adopt = useCallback((result: PipelineResult) => {
    setState({
      ...INITIAL,
      stage: 'review',
      percent: 1,
      doc: result.doc,
      pages: result.pages,
      fragments: result.fragments,
      coverFragment: result.coverFragment,
      source: result.source,
      warnings: result.warnings,
      files: result.files,
      progress: 'Готово',
    });
  }, []);

  const fail = useCallback((error: unknown) => {
    if (error instanceof PipelineError) {
      setState((prev) => ({ ...prev, stage: 'error', error: { message: error.message, hint: error.hint } }));
      return;
    }
    const message = error instanceof Error ? error.message : 'Что-то пошло не так.';
    setState((prev) => ({
      ...prev,
      stage: 'error',
      error: { message, hint: 'Попробуйте ещё раз или откройте готовый пример.' },
    }));
  }, []);

  const start = useCallback(
    async (files: File[]) => {
      setState({
        ...INITIAL,
        stage: 'working',
        progress: 'Читаем файл',
        percent: 0.05,
        files: files.map((file) => file.name),
      });
      try {
        const result = await importFiles(files, report);
        if (mounted.current) {
          adopt(result);
        }
      } catch (error) {
        if (mounted.current) {
          fail(error);
        }
      }
    },
    [adopt, fail, report],
  );

  const openExample = useCallback(
    async (id: DemoId) => {
      setState({ ...INITIAL, stage: 'working', progress: 'Открываем пример', percent: 0.3 });
      try {
        const result = await openDemo(id);
        if (mounted.current) {
          adopt(result);
        }
      } catch (error) {
        if (mounted.current) {
          fail(error);
        }
      }
    },
    [adopt, fail],
  );

  const reset = useCallback(() => setState(INITIAL), []);

  const mutate = useCallback((fn: (doc: IkGuideDocument) => IkGuideDocument) => {
    setState((prev) => {
      if (!prev.doc) return prev;
      const next = fn(prev.doc);
      // Повторный commit того же значения не должен создавать фиктивный шаг Undo.
      if (next === prev.doc || JSON.stringify(next) === JSON.stringify(prev.doc)) return prev;
      return { ...prev, doc: next, pdfJob: null, history: [...prev.history, prev.doc].slice(-HISTORY_LIMIT) };
    });
  }, []);

  /**
   * Отмена — это возврат к снимку документа до последней правки. Снимки неизменяемы, поэтому
   * достаточно отдать предыдущий: ROI-пины, шаги и чек-лист вернутся вместе.
   */
  const undo = useCallback(() => {
    setState((prev) => {
      const previous = prev.history[prev.history.length - 1];
      if (!prev.doc || !previous) {
        return prev;
      }
      return {
        ...prev,
        doc: previous,
        history: prev.history.slice(0, -1),
        pdfJob: null,
        pdfBusy: false,
      };
    });
  }, []);

  const actions = useMemo<PipelineActions>(
    () => ({
      start,
      openExample,
      reset,
      editTitle: (title) => mutate((doc) => setTitle(doc, title)),
      editMeta: (patch) => mutate((doc) => setMeta(doc, patch)),
      editStepText: (stepId, text) => mutate((doc) => setStepText(doc, stepId, text)),
      editStepTitle: (stepId, title) => mutate((doc) => setStepTitle(doc, stepId, title)),
      editAntiError: (stepId, text) => mutate((doc) => setAntiError(doc, stepId, text)),
      resolveSize: (annotationId, value) => mutate((doc) => applyDimensionFix(doc, annotationId, value)),
      editAnnotationNote: (annotationId, note) => mutate((doc) => setAnnotationNote(doc, annotationId, note)),
      editChecklistText: (itemId, text) => mutate((doc) => setChecklistText(doc, itemId, text)),
      toggleChecklistItem: (itemId) => mutate((doc) => toggleChecklistRequired(doc, itemId)),
      undo,
      download: async () => {
        const current = docRef.current;
        if (!current) {
          return;
        }
        setState((prev) => ({ ...prev, pdfBusy: true, error: null }));
        try {
          const latest = stateRef.current;
          const job = await renderPdf(
            current,
            buildIllustrations(current, { steps: latest.fragments, cover: latest.coverFragment }),
          );
          await downloadPdf(job);
          if (mounted.current) {
            setState((prev) => ({ ...prev, pdfBusy: false, pdfJob: job }));
          }
        } catch (error) {
          if (mounted.current) {
            setState((prev) => ({
              ...prev,
              pdfBusy: false,
              error: {
                message: 'Не удалось собрать PDF.',
                hint: error instanceof Error ? error.message : 'Повторите попытку.',
              },
            }));
          }
        }
      },
    }),
    [mutate, openExample, reset, start, undo],
  );

  const illustrations = useMemo(
    () =>
      state.doc
        ? buildIllustrations(state.doc, { steps: state.fragments, cover: state.coverFragment })
        : { cover: undefined, steps: {} },
    [state.doc, state.fragments, state.coverFragment],
  );
  const ambiguous = useMemo(() => (state.doc ? ambiguousSizes(state.doc) : []), [state.doc]);
  const softNotes = useMemo(() => (state.doc ? lowConfidenceNotes(state.doc) : []), [state.doc]);

  return { ...state, illustrations, ambiguous, softNotes, canUndo: state.history.length > 0, actions };
}
