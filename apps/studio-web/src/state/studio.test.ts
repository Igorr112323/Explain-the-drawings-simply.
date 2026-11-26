import { describe, expect, it } from 'vitest';
import { getUnconfirmedAnnotations, moveStep } from '@ikguide/schema';
import { DEMO_DOCUMENTS } from '../data/demos';
import { emptyVisionSession, type VisionCandidate, type VisionSession } from '../lib/vision';
import { studioReducer, type StudioState } from './studio';

function baseState(overrides: Partial<StudioState> = {}): StudioState {
  return {
    theme: 'light',
    mode: 'worker',
    screen: 'home',
    stepIndex: 0,
    activeDocId: DEMO_DOCUMENTS[0]!.id,
    docs: structuredClone([...DEMO_DOCUMENTS]),
    qcDone: {},
    uploadedImage: null,
    toast: null,
    focusedAnnotationId: null,
    manualNotation: '',
    scan: { open: false, mode: 'files', files: [] },
    vision: null,
    ...overrides,
  };
}

function candidate(id: string, text: string): VisionCandidate {
  return {
    id,
    pageIndex: 0,
    rawText: text,
    normalizedText: text,
    xPercent: 10,
    yPercent: 10,
    bboxPercent: { x: 9, y: 9, w: 4, h: 3 },
    confidence: 0.9,
    ambiguousOptions: [],
    region: 'field',
    source: 'ocr',
  };
}

function session(overrides: Partial<VisionSession> = {}): VisionSession {
  return {
    ...emptyVisionSession(),
    requestId: 'req-1',
    pageId: 'pg-1',
    candidates: [candidate('c1', 'Ø20 H7')],
    ...overrides,
  };
}

describe('studio reducer', () => {
  it('switches modes, screens and themes', () => {
    const state = baseState();
    expect(studioReducer(state, { type: 'SET_MODE', mode: 'engineer' }).mode).toBe('engineer');
    expect(studioReducer(state, { type: 'SET_SCREEN', screen: 'qc' }).screen).toBe('qc');
    expect(studioReducer(state, { type: 'SET_THEME', theme: 'dark' }).theme).toBe('dark');
  });

  it('clamps the step index to the document bounds', () => {
    const state = baseState();
    expect(studioReducer(state, { type: 'GO_STEP', index: 99 }).stepIndex).toBe(DEMO_DOCUMENTS[0]!.steps.length - 1);
    expect(studioReducer(state, { type: 'GO_STEP', index: -5 }).stepIndex).toBe(0);
  });

  it('confirms an uncertain annotation with the human value', () => {
    const state = baseState();
    const doc = state.docs[0]!;
    const uncertain = getUnconfirmedAnnotations(doc)[0]!;
    const next = studioReducer(state, { type: 'CONFIRM_ANNOTATION', annotationId: uncertain.id, value: '18 мм' });
    const updated = next.docs[0]!.xrayAnnotations.find((item) => item.id === uncertain.id);
    expect(updated?.confirmedByHuman).toBe(true);
    expect(updated?.resolvedValue).toBe('18 мм');
    expect(getUnconfirmedAnnotations(next.docs[0]!).length).toBe(getUnconfirmedAnnotations(doc).length - 1);
  });

  it('patches only the active document and keeps step index valid', () => {
    const state = baseState({ stepIndex: 5 });
    const activeId = state.activeDocId;
    const next = studioReducer(state, {
      type: 'PATCH_DOC',
      updater: (doc) => ({ ...doc, steps: moveStep(doc.steps, 0, 1) }),
    });
    const untouchedId = next.docs.find((doc) => doc.id !== activeId)?.id;
    expect(next.docs.find((doc) => doc.id === activeId)?.steps[0]?.id).toBe(state.docs[0]!.steps[1]!.id);
    expect(next.docs.find((doc) => doc.id === untouchedId)).toEqual(
      state.docs.find((doc) => doc.id === untouchedId),
    );
    expect(next.stepIndex).toBeLessThan(next.docs[0]!.steps.length);
  });

  it('tracks the qc checklist per document', () => {
    let state = baseState();
    const itemId = state.docs[0]!.qcChecklist[0]!.id;
    state = studioReducer(state, { type: 'TOGGLE_QC', itemId });
    expect(state.qcDone[state.activeDocId]).toEqual([itemId]);
    state = studioReducer(state, { type: 'TOGGLE_QC', itemId });
    expect(state.qcDone[state.activeDocId]).toEqual([]);
    state = studioReducer(state, { type: 'TOGGLE_QC', itemId });
    state = studioReducer(state, { type: 'RESET_QC' });
    expect(state.qcDone[state.activeDocId]).toEqual([]);
  });

  it('imports a document without leaving the engineer mode', () => {
    const state = baseState({ mode: 'engineer' });
    const imported = { ...structuredClone(DEMO_DOCUMENTS[1]!), id: 'imported-guide', metadata: { ...DEMO_DOCUMENTS[1]!.metadata, title: 'Импортированная' } };
    const next = studioReducer(state, { type: 'IMPORT_DOC', doc: imported });
    expect(next.mode).toBe('engineer');
    expect(next.activeDocId).toBe('imported-guide');
    expect(next.docs.some((doc) => doc.id === 'imported-guide')).toBe(true);
  });

  it('replaces a document with the same id on import instead of duplicating it', () => {
    const state = baseState();
    const changed = { ...structuredClone(state.docs[0]!), metadata: { ...state.docs[0]!.metadata, title: 'Новое имя' } };
    const next = studioReducer(state, { type: 'IMPORT_DOC', doc: changed });
    expect(next.docs.filter((doc) => doc.id === changed.id)).toHaveLength(1);
    expect(next.docs.find((doc) => doc.id === changed.id)?.metadata.title).toBe('Новое имя');
  });

  it('selects a document and resets the step pointer', () => {
    const state = baseState({ stepIndex: 4 });
    const other = state.docs[1]!;
    const next = studioReducer(state, { type: 'SELECT_DOC', docId: other.id });
    expect(next.activeDocId).toBe(other.id);
    expect(next.stepIndex).toBe(0);
  });

  it('stores and clears toasts, focus and manual notation', () => {
    let state = baseState();
    state = studioReducer(state, { type: 'SHOW_TOAST', text: 'Готово', tone: 'success' });
    expect(state.toast?.text).toBe('Готово');
    state = studioReducer(state, { type: 'CLEAR_TOAST' });
    expect(state.toast).toBeNull();
    state = studioReducer(state, { type: 'FOCUS_ANNOTATION', annotationId: 'ann-fit-20h7' });
    expect(state.focusedAnnotationId).toBe('ann-fit-20h7');
    state = studioReducer(state, { type: 'SET_MANUAL_NOTATION', value: 'Ra 0.8' });
    expect(state.manualNotation).toBe('Ra 0.8');
    state = studioReducer(state, { type: 'SET_UPLOADED_IMAGE', src: 'data:image/png;base64,AAAA' });
    expect(state.uploadedImage).toContain('data:image');
  });

  it('opens and closes the scan dialog with its sheet list', () => {
    const state = baseState();
    const sheet = new File([new Uint8Array([1])], 'sheet.pdf', { type: 'application/pdf' });
    const opened = studioReducer(state, { type: 'OPEN_SCAN', mode: 'camera', files: [sheet] });
    expect(opened.scan).toMatchObject({ open: true, mode: 'camera' });
    expect(opened.scan.files).toHaveLength(1);

    const closed = studioReducer(opened, { type: 'CLOSE_SCAN' });
    expect(closed.scan.open).toBe(false);
    expect(closed.scan.files).toHaveLength(0);
    expect(closed.scan.mode).toBe('camera');
  });

  it('keeps exactly one auto-built draft and makes it active', () => {
    const state = baseState();
    const withSession = studioReducer(state, {
      type: 'SET_VISION_SESSION',
      session: session(),
      image: 'data:image/png;base64,AAAA',
    });
    expect(withSession.uploadedImage).toContain('data:image');

    const firstDraft = { ...structuredClone(DEMO_DOCUMENTS[0]!), id: 'guide-draft-1' };
    const secondDraft = { ...structuredClone(DEMO_DOCUMENTS[0]!), id: 'guide-draft-2' };

    let next = studioReducer(withSession, { type: 'SET_VISION_DRAFT', doc: firstDraft });
    expect(next.activeDocId).toBe('guide-draft-1');
    expect(next.vision?.draftDocId).toBe('guide-draft-1');

    next = studioReducer(next, { type: 'SET_VISION_DRAFT', doc: secondDraft });
    expect(next.docs.some((doc) => doc.id === 'guide-draft-1')).toBe(false);
    expect(next.docs.filter((doc) => doc.id === 'guide-draft-2')).toHaveLength(1);
    expect(next.activeDocId).toBe('guide-draft-2');
    expect(next.stepIndex).toBe(0);
  });

  it('merges region results without duplicates and keeps warnings unique', () => {
    const state = baseState({ vision: session({ warnings: ['низкий контраст'] }) });
    const next = studioReducer(state, {
      type: 'ADD_VISION_CANDIDATES',
      candidates: [candidate('c1', 'Ø20 H7'), candidate('c2', 'Ø32 H7')],
      warnings: ['низкий контраст', 'область перечитана'],
    });

    expect(next.vision?.candidates.map((item) => item.id)).toEqual(['c1', 'c2']);
    expect(next.vision?.warnings).toEqual(['низкий контраст', 'область перечитана']);

    const unchanged = studioReducer(next, { type: 'ADD_VISION_CANDIDATES', candidates: [candidate('c1', 'Ø20 H7')] });
    expect(unchanged).toBe(next);
  });

  it('accepts a hand-typed cipher once and clears the input', () => {
    const state = baseState({ vision: session(), manualNotation: '  М10×1,25  ' });
    const next = studioReducer(state, { type: 'ADD_MANUAL_NOTATION', value: 'М10×1,25' });
    expect(next.vision?.manualNotations).toEqual(['М10×1,25']);
    expect(next.manualNotation).toBe('');

    const duplicate = studioReducer({ ...next, manualNotation: 'М10×1,25' }, { type: 'ADD_MANUAL_NOTATION', value: 'М10×1,25' });
    expect(duplicate.vision?.manualNotations).toEqual(['М10×1,25']);
    expect(duplicate.manualNotation).toBe('');

    const blank = studioReducer(next, { type: 'ADD_MANUAL_NOTATION', value: '   ' });
    expect(blank).toBe(next);
  });

  it('ignores vision actions when no sheet session exists', () => {
    const state = baseState();
    expect(studioReducer(state, { type: 'ADD_MANUAL_NOTATION', value: 'М8' })).toBe(state);
    expect(studioReducer(state, { type: 'ADD_VISION_CANDIDATES', candidates: [candidate('c9', 'М8')] })).toBe(state);
  });

  it('clears the recognised sheet and its preview image', () => {
    const state = baseState({
      vision: session(),
      uploadedImage: 'data:image/png;base64,AAAA',
      focusedAnnotationId: 'ann-fit-20h7',
    });
    const next = studioReducer(state, { type: 'CLEAR_VISION' });
    expect(next.vision).toBeNull();
    expect(next.uploadedImage).toBeNull();
  });
});
