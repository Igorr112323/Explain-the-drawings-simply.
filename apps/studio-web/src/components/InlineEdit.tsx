import { useEffect, useRef, useState } from 'react';

/**
 * Текст, который можно править прямо на месте: клик → поле ввода, Enter/потеря фокуса → сохранить,
 * Esc → отменить. Так правятся название детали, шифр, материал и текст шага.
 */
export function InlineEdit({
  value,
  onCommit,
  className,
  ariaLabel,
  multiline = false,
  placeholder,
}: {
  value: string;
  onCommit: (next: string) => void;
  className?: string;
  ariaLabel: string;
  multiline?: boolean;
  placeholder?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLTextAreaElement | HTMLInputElement | null>(null);

  useEffect(() => {
    if (!editing) {
      setDraft(value);
    }
  }, [editing, value]);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  const commit = () => {
    setEditing(false);
    const clean = draft.trim();
    if (clean.length > 0 && clean !== value) {
      onCommit(clean);
    }
  };

  if (!editing) {
    return (
      <button
        type="button"
        className={`inline-edit ${className ?? ''}`}
        onClick={() => setEditing(true)}
        aria-label={`${ariaLabel}: изменить`}
        title="Нажмите, чтобы изменить"
      >
        {value || placeholder || '—'}
      </button>
    );
  }

  const shared = {
    value: draft,
    'aria-label': ariaLabel,
    className: 'inline-input',
    onChange: (event: { target: { value: string } }) => setDraft(event.target.value),
    onBlur: commit,
    onKeyDown: (event: React.KeyboardEvent) => {
      if (event.key === 'Escape') {
        setDraft(value);
        setEditing(false);
      }
      if (event.key === 'Enter' && !multiline) {
        event.preventDefault();
        commit();
      }
      if (event.key === 'Enter' && multiline && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        commit();
      }
    },
  } as const;

  return multiline ? (
    <textarea {...shared} rows={3} ref={(node) => void (inputRef.current = node)} />
  ) : (
    <input {...shared} type="text" ref={(node) => void (inputRef.current = node)} />
  );
}
