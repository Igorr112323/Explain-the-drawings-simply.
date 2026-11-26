import type { ReactNode } from 'react';
import { pluralRu } from '@ikguide/gost-translator';
import { useStudio } from '../../state/studio';
import { WarnGlyph } from '../common/Glyphs';

interface WorkerHeaderProps {
  title: string;
  subtitle?: string;
  onBack?: () => void;
  trailing?: ReactNode;
}

export function WorkerHeader({ title, subtitle, onBack, trailing }: WorkerHeaderProps) {
  return (
    <header className="worker-header">
      <div className="worker-header-row">
        {onBack ? (
          <button type="button" className="tap-button tap-ghost" onClick={onBack} aria-label="Назад">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round">
              <path d="M15 5l-7 7 7 7" />
            </svg>
          </button>
        ) : null}
        <div className="worker-heading">
          <h1>{title}</h1>
          {subtitle ? <p>{subtitle}</p> : null}
        </div>
        {trailing ? <div className="worker-header-trailing">{trailing}</div> : null}
      </div>
    </header>
  );
}

export function UncertaintyBanner({ onOpen }: { onOpen: () => void }) {
  const { unconfirmed } = useStudio();
  if (unconfirmed.length === 0) {
    return null;
  }
  return (
    <button type="button" className="banner banner-warning" onClick={onOpen}>
      <span className="banner-icon">
        <WarnGlyph />
      </span>
      <span className="banner-text">
        <strong>
          {unconfirmed.length} {pluralRu(unconfirmed.length, 'обозначение', 'обозначения', 'обозначений')} не{' '}
          {pluralRu(unconfirmed.length, 'подтверждено', 'подтверждены', 'подтверждено')}
        </strong>
        <small>Проверьте до начала работы, иначе брак уйдёт в деталь.</small>
      </span>
      <span className="banner-arrow" aria-hidden="true">
        →
      </span>
    </button>
  );
}

export function ScreenBody({ children }: { children: ReactNode }) {
  return <div className="screen-body">{children}</div>;
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="section-title">
      <h2>{children}</h2>
      {action}
    </div>
  );
}
