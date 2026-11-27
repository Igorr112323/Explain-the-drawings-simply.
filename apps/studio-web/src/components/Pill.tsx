/**
 * Парящие капсулы и поповеры холста — всё, из чего собран интерфейс.
 *
 * Пять капсул (назад, экспорт, примеры, инструменты, пометка) — это одни и те же примитивы:
 * полупрозрачное белое «стекло», тонкая граница, мягкая тень и круглые кнопки внутри. Поповеры
 * растут из своей капсулы, закрываются по Esc и по клику мимо — как в Apple Freeform.
 */
import { useEffect, useRef, type ReactNode } from 'react';
import { IconClose } from './icons';

export function Pill({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={`pill ${className ?? ''}`}>{children}</div>;
}

/** Кнопка внутри капсулы: 40×40, тонкая иконка, синий акцент при наведении и в активном режиме. */
export function PillButton({
  label,
  onClick,
  disabled = false,
  active = false,
  indicator = false,
  expanded,
  trigger = false,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  indicator?: boolean;
  expanded?: boolean;
  trigger?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className="pill-btn"
      data-active={active ? 'true' : undefined}
      aria-label={label}
      title={label}
      aria-expanded={expanded}
      disabled={disabled}
      onClick={onClick}
      {...(trigger ? { 'data-popover-trigger': '' } : {})}
    >
      {children}
      {indicator && <span className="pill-dot" aria-hidden="true" />}
    </button>
  );
}

/** Круглая кнопка по углам холста: 44 px сверху, 48 px снизу. */
export function RoundButton({
  label,
  onClick,
  disabled = false,
  active = false,
  indicator = false,
  size = 48,
  trigger = false,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  indicator?: boolean;
  size?: 44 | 48;
  trigger?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={`round round-${size}`}
      data-active={active ? 'true' : undefined}
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      {...(trigger ? { 'data-popover-trigger': '' } : {})}
    >
      {children}
      {indicator && <span className="pill-dot" aria-hidden="true" />}
    </button>
  );
}

/**
 * Поповер, «выросший» из капсулы. `placement` задаёт, с какой стороны от неё он появится,
 * `align` — к какому краю прижаться.
 */
export function Popover({
  title,
  onClose,
  placement = 'above',
  align = 'center',
  width = 420,
  children,
}: {
  title: string;
  onClose: () => void;
  placement?: 'above' | 'below';
  align?: 'start' | 'center' | 'end';
  width?: number;
  children: ReactNode;
}) {
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    const onDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target || box.current?.contains(target)) {
        return;
      }
      // Клик по кнопке-триггеру обрабатывает она сама, иначе поповер мигнул бы и открылся снова.
      if (target instanceof Element && target.closest('[data-popover-trigger]')) {
        return;
      }
      onClose();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
    };
  }, [onClose]);

  return (
    <div
      ref={box}
      className="popover"
      role="dialog"
      aria-label={title}
      data-placement={placement}
      data-align={align}
      style={{ width: `min(${width}px, calc(100vw - 36px))` }}
    >
      <header className="popover-head">
        <h2 className="popover-title">{title}</h2>
        <button type="button" className="popover-close" onClick={onClose} aria-label="Закрыть" title="Закрыть (Esc)">
          <IconClose size={18} />
        </button>
      </header>
      <div className="popover-body">{children}</div>
    </div>
  );
}
