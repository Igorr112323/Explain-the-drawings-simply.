import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  type Dispatch,
  type ReactNode,
} from 'react';
import {
  documentStats,
  getUnconfirmedAnnotations,
  ikGuideDocumentSchema,
  toggleAnnotationConfirmation,
  type DocumentStats,
  type IkGuideDocument,
  type XrayAnnotation,
} from '@ikguide/schema';
import { DEMO_DOCUMENTS } from '../data/demos';
import type { VisionCandidate, VisionSession } from '../lib/vision';

export type StudioMode = 'worker' | 'engineer';
export type WorkerScreen = 'home' | 'verify' | 'prep' | 'steps' | 'xray' | 'qc' | 'done';
export type Theme = 'light' | 'dark';
/** «Схема IKEA» (SVG) or «3D-модель» (WebGL) — the worker can switch on every step. */
export type ViewMode = '2d' | '3d';

export interface ToastMessage {
  id: number;
  text: string;
  tone: 'info' | 'success' | 'danger';
}

export interface ScanRequest {
  open: boolean;
  mode: 'files' | 'camera';
  files: File[];
}

export interface StudioState {
  theme: Theme;
  mode: StudioMode;
  screen: WorkerScreen;
  stepIndex: number;
  activeDocId: string;
  docs: IkGuideDocument[];
  qcDone: Record<string, string[]>;
  uploadedImage: string | null;
  toast: ToastMessage | null;
  focusedAnnotationId: string | null;
  manualNotation: string;
  /** Chosen presentation of the step stage; ignored by documents without a 3D assembly. */
  viewMode: ViewMode;
  scan: ScanRequest;
  /** Recognition session does not survive a reload on purpose: the sheet images are large. */
  vision: VisionSession | null;
}

export type StudioAction =
  | { type: 'SET_THEME'; theme: Theme }
  | { type: 'SET_MODE'; mode: StudioMode }
  | { type: 'SET_SCREEN'; screen: WorkerScreen }
  | { type: 'GO_STEP'; index: number }
  | { type: 'SELECT_DOC'; docId: string }
  | { type: 'CONFIRM_ANNOTATION'; annotationId: string; value?: string }
  | { type: 'PATCH_DOC'; updater: (doc: IkGuideDocument) => IkGuideDocument }
  | { type: 'IMPORT_DOC'; doc: IkGuideDocument }
  | { type: 'TOGGLE_QC'; itemId: string }
  | { type: 'RESET_QC' }
  | { type: 'SET_UPLOADED_IMAGE'; src: string | null }
  | { type: 'SHOW_TOAST'; text: string; tone: ToastMessage['tone'] }
  | { type: 'CLEAR_TOAST' }
  | { type: 'FOCUS_ANNOTATION'; annotationId: string | null }
  | { type: 'SET_MANUAL_NOTATION'; value: string }
  | { type: 'SET_VIEW_MODE'; mode: ViewMode }
  | { type: 'OPEN_SCAN'; mode: 'files' | 'camera'; files?: File[] }
  | { type: 'CLOSE_SCAN' }
  | { type: 'SET_VISION_SESSION'; session: VisionSession; image: string | null }
  | { type: 'SET_VISION_DRAFT'; doc: IkGuideDocument }
  | { type: 'ADD_VISION_CANDIDATES'; candidates: VisionCandidate[]; warnings?: string[] }
  | { type: 'ADD_MANUAL_NOTATION'; value: string }
  | { type: 'CLEAR_VISION' };

const STORAGE_KEY = 'ikguide.studio.v1';

interface PersistedState {
  theme: Theme;
  docs: IkGuideDocument[];
  qcDone: Record<string, string[]>;
  activeDocId: string;
}

function clampStepIndex(index: number, doc: IkGuideDocument): number {
  if (doc.steps.length === 0) {
    return 0;
  }
  return Math.min(Math.max(index, 0), doc.steps.length - 1);
}

function cloneDocument(doc: IkGuideDocument): IkGuideDocument {
  return JSON.parse(JSON.stringify(doc)) as IkGuideDocument;
}

function initialState(): StudioState {
  const fallback: StudioState = {
    theme: 'light',
    mode: 'worker',
    screen: 'home',
    stepIndex: 0,
    activeDocId: DEMO_DOCUMENTS[0]!.id,
    docs: DEMO_DOCUMENTS.map((doc) => cloneDocument(doc)),
    qcDone: {},
    uploadedImage: null,
    toast: null,
    focusedAnnotationId: null,
    manualNotation: '',
    viewMode: '2d',
    scan: { open: false, mode: 'files', files: [] },
    vision: null,
  };

  if (typeof window === 'undefined') {
    return fallback;
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return fallback;
    }
    const parsed = JSON.parse(raw) as Partial<PersistedState>;
    const docs = Array.isArray(parsed.docs)
      ? parsed.docs.flatMap((candidate) => {
          const validation = ikGuideDocumentSchema.safeParse(candidate);
          return validation.success ? [validation.data] : [];
        })
      : [];
    if (docs.length === 0) {
      return fallback;
    }
    const activeDocId = docs.some((doc) => doc.id === parsed.activeDocId) ? String(parsed.activeDocId) : docs[0]!.id;
    return {
      ...fallback,
      theme: parsed.theme === 'dark' ? 'dark' : 'light',
      docs,
      qcDone: parsed.qcDone && typeof parsed.qcDone === 'object' ? parsed.qcDone : {},
      activeDocId,
    };
  } catch {
    return fallback;
  }
}

function patchActiveDoc(state: StudioState, updater: (doc: IkGuideDocument) => IkGuideDocument): StudioState {
  const docs = state.docs.map((doc) => (doc.id === state.activeDocId ? updater(doc) : doc));
  const activeDoc = docs.find((doc) => doc.id === state.activeDocId) ?? docs[0];
  return {
    ...state,
    docs,
    stepIndex: activeDoc ? clampStepIndex(state.stepIndex, activeDoc) : 0,
  };
}

export function studioReducer(state: StudioState, action: StudioAction): StudioState {
  switch (action.type) {
    case 'SET_THEME':
      return { ...state, theme: action.theme };
    case 'SET_MODE':
      return { ...state, mode: action.mode };
    case 'SET_SCREEN':
      return { ...state, screen: action.screen, focusedAnnotationId: null };
    case 'GO_STEP': {
      const doc = state.docs.find((item) => item.id === state.activeDocId);
      if (!doc) {
        return state;
      }
      return { ...state, stepIndex: clampStepIndex(action.index, doc) };
    }
    case 'SELECT_DOC':
      return {
        ...state,
        activeDocId: action.docId,
        stepIndex: 0,
        viewMode: '2d',
        screen: state.mode === 'worker' ? 'home' : state.screen,
        focusedAnnotationId: null,
      };
    case 'CONFIRM_ANNOTATION':
      return patchActiveDoc(state, (doc) => toggleAnnotationConfirmation(doc, action.annotationId, action.value));
    case 'PATCH_DOC':
      return patchActiveDoc(state, action.updater);
    case 'IMPORT_DOC': {
      const others = state.docs.filter((doc) => doc.id !== action.doc.id);
      return {
        ...state,
        docs: [...others, action.doc],
        activeDocId: action.doc.id,
        stepIndex: 0,
        screen: state.mode === 'worker' ? 'prep' : state.screen,
      };
    }
    case 'TOGGLE_QC': {
      const completed = state.qcDone[state.activeDocId] ?? [];
      const next = completed.includes(action.itemId)
        ? completed.filter((id) => id !== action.itemId)
        : [...completed, action.itemId];
      return { ...state, qcDone: { ...state.qcDone, [state.activeDocId]: next } };
    }
    case 'RESET_QC':
      return { ...state, qcDone: { ...state.qcDone, [state.activeDocId]: [] } };
    case 'SET_UPLOADED_IMAGE':
      return { ...state, uploadedImage: action.src };
    case 'SHOW_TOAST':
      return { ...state, toast: { id: Date.now(), text: action.text, tone: action.tone } };
    case 'CLEAR_TOAST':
      return { ...state, toast: null };
    case 'FOCUS_ANNOTATION':
      return { ...state, focusedAnnotationId: action.annotationId };
    case 'SET_MANUAL_NOTATION':
      return { ...state, manualNotation: action.value };
    case 'SET_VIEW_MODE':
      return { ...state, viewMode: action.mode };
    case 'OPEN_SCAN':
      return {
        ...state,
        scan: { open: true, mode: action.mode, files: action.files ?? [] },
      };
    case 'CLOSE_SCAN':
      return { ...state, scan: { open: false, mode: state.scan.mode, files: [] } };
    case 'SET_VISION_SESSION':
      return {
        ...state,
        vision: action.session,
        uploadedImage: action.image ?? state.uploadedImage,
        focusedAnnotationId: null,
      };
    case 'SET_VISION_DRAFT': {
      const previousDraftId = state.vision?.draftDocId ?? null;
      const docs = [...state.docs.filter((doc) => doc.id !== action.doc.id && doc.id !== previousDraftId), action.doc];
      return {
        ...state,
        docs,
        activeDocId: action.doc.id,
        stepIndex: 0,
        vision: state.vision ? { ...state.vision, draftDocId: action.doc.id } : state.vision,
      };
    }
    case 'ADD_VISION_CANDIDATES': {
      if (!state.vision) {
        return state;
      }
      const known = new Set(state.vision.candidates.map((candidate) => candidate.id));
      const fresh = action.candidates.filter((candidate) => !known.has(candidate.id));
      if (fresh.length === 0) {
        return state;
      }
      return {
        ...state,
        vision: {
          ...state.vision,
          candidates: [...state.vision.candidates, ...fresh],
          warnings: [...new Set([...state.vision.warnings, ...(action.warnings ?? [])])],
        },
      };
    }
    case 'ADD_MANUAL_NOTATION': {
      if (!state.vision) {
        return state;
      }
      const value = action.value.trim();
      if (value.length === 0) {
        return state;
      }
      if (state.vision.manualNotations.includes(value)) {
        // Already in the draft: just clear the field so the engineer can type the next cipher.
        return { ...state, manualNotation: '' };
      }
      return {
        ...state,
        vision: { ...state.vision, manualNotations: [...state.vision.manualNotations, value] },
        manualNotation: '',
      };
    }
    case 'CLEAR_VISION':
      return { ...state, vision: null, uploadedImage: null };
    default:
      return state;
  }
}

interface StudioContextValue {
  state: StudioState;
  doc: IkGuideDocument;
  dispatch: Dispatch<StudioAction>;
  stats: DocumentStats;
  unconfirmed: XrayAnnotation[];
  qcCompleted: string[];
  isQcComplete: boolean;
}

const StudioContext = createContext<StudioContextValue | null>(null);

export function StudioProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(studioReducer, undefined, initialState);

  const doc = state.docs.find((item) => item.id === state.activeDocId) ?? state.docs[0] ?? DEMO_DOCUMENTS[0]!;
  const stats = useMemo(() => documentStats(doc), [doc]);
  const unconfirmed = useMemo(() => getUnconfirmedAnnotations(doc), [doc]);
  const qcCompleted = state.qcDone[doc.id] ?? [];
  const isQcComplete = doc.qcChecklist.filter((item) => item.required).every((item) => qcCompleted.includes(item.id));

  useEffect(() => {
    document.documentElement.dataset.theme = state.theme;
    document.documentElement.style.colorScheme = state.theme;
  }, [state.theme]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    const payload: PersistedState = {
      theme: state.theme,
      docs: state.docs,
      qcDone: state.qcDone,
      activeDocId: state.activeDocId,
    };
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch {
      // Storage can be unavailable in private mode; the studio still works in memory.
    }
  }, [state.theme, state.docs, state.qcDone, state.activeDocId]);

  const value: StudioContextValue = {
    state,
    doc,
    dispatch,
    stats,
    unconfirmed,
    qcCompleted,
    isQcComplete,
  };

  return <StudioContext.Provider value={value}>{children}</StudioContext.Provider>;
}

export function useStudio(): StudioContextValue {
  const context = useContext(StudioContext);
  if (!context) {
    throw new Error('useStudio must be used inside <StudioProvider>');
  }
  return context;
}
