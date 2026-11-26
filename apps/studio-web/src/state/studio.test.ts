import { describe, expect, it } from 'vitest';
import { getUnconfirmedAnnotations, moveStep } from '@ikguide/schema';
import { DEMO_DOCUMENTS } from '../data/demos';
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
});
