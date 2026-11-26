import { useEffect } from 'react';
import { useStudio } from '../state/studio';

export function ToastHost() {
  const { state, dispatch } = useStudio();
  const toast = state.toast;

  useEffect(() => {
    if (!toast) {
      return;
    }
    const timer = window.setTimeout(() => dispatch({ type: 'CLEAR_TOAST' }), 5200);
    return () => window.clearTimeout(timer);
  }, [toast, dispatch]);

  if (!toast) {
    return null;
  }

  return (
    <div className={`toast toast-${toast.tone}`} role="status" aria-live="polite">
      <span className="toast-text">{toast.text}</span>
      <button type="button" className="toast-close" onClick={() => dispatch({ type: 'CLEAR_TOAST' })} aria-label="Закрыть уведомление">
        ✕
      </button>
    </div>
  );
}
