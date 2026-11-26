import type { BomIcon, ToolCategory } from '@ikguide/schema';

const STROKE = 'currentColor';

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <svg viewBox="0 0 32 32" width="26" height="26" fill="none" stroke={STROKE} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

export function BomGlyph({ icon }: { icon: BomIcon }) {
  switch (icon) {
    case 'bolt':
      return (
        <Frame>
          <path d="M11 6h10l3 5-3 5H11L8 11z" />
          <path d="M16 16v10M13 26h6" />
        </Frame>
      );
    case 'nut':
      return (
        <Frame>
          <path d="M16 5l9 5v12l-9 5-9-5V10z" />
          <circle cx="16" cy="16" r="4" />
        </Frame>
      );
    case 'washer':
      return (
        <Frame>
          <circle cx="16" cy="16" r="10" />
          <circle cx="16" cy="16" r="5" />
        </Frame>
      );
    case 'screw':
      return (
        <Frame>
          <path d="M11 5h10l-2 6H13z" />
          <path d="M13 11h6v4l-3 12-3-12z" />
        </Frame>
      );
    case 'pin':
      return (
        <Frame>
          <rect x="7" y="11" width="18" height="10" rx="5" />
          <path d="M11 13v6M16 13v6M21 13v6" />
        </Frame>
      );
    case 'bearing':
      return (
        <Frame>
          <circle cx="16" cy="16" r="11" />
          <circle cx="16" cy="16" r="5" />
          <circle cx="16" cy="8" r="1.4" fill={STROKE} />
          <circle cx="23" cy="20" r="1.4" fill={STROKE} />
          <circle cx="9" cy="20" r="1.4" fill={STROKE} />
        </Frame>
      );
    case 'seal':
      return (
        <Frame>
          <circle cx="16" cy="16" r="11" />
          <circle cx="16" cy="16" r="7" strokeDasharray="2 3" />
          <path d="M16 5v5M16 22v5" />
        </Frame>
      );
    case 'plate':
      return (
        <Frame>
          <rect x="5" y="9" width="22" height="14" rx="3" />
          <path d="M10 16h12" />
        </Frame>
      );
    case 'servo':
      return (
        <Frame>
          <rect x="8" y="9" width="16" height="14" rx="3" />
          <circle cx="16" cy="14" r="3" />
          <path d="M16 23v4M12 27h8" />
        </Frame>
      );
    case 'bracket':
      return (
        <Frame>
          <path d="M7 24V8h12" />
          <path d="M7 24h18" />
          <path d="M13 12l10 10" />
        </Frame>
      );
    case 'sensor':
      return (
        <Frame>
          <circle cx="16" cy="16" r="6" />
          <path d="M16 4v4M16 24v4M4 16h4M24 16h4" />
        </Frame>
      );
    case 'cable':
      return (
        <Frame>
          <path d="M6 22c4 0 4-12 8-12s4 12 8 12 4-6 4-6" />
          <circle cx="6" cy="22" r="2" fill={STROKE} />
        </Frame>
      );
    default:
      return (
        <Frame>
          <rect x="7" y="7" width="18" height="18" rx="4" />
        </Frame>
      );
  }
}

export function ToolGlyph({ category }: { category: ToolCategory }) {
  switch (category) {
    case 'drill':
      return (
        <Frame>
          <path d="M16 4v10" />
          <path d="M12 14h8l-4 14z" />
          <path d="M12 8h8M13 11h6" />
        </Frame>
      );
    case 'tap':
    case 'die':
      return (
        <Frame>
          <path d="M16 6v20" />
          <path d="M8 6h16" />
          <path d="M12 12h8M12 16h8M12 20h8" />
        </Frame>
      );
    case 'reamer':
      return (
        <Frame>
          <path d="M16 4v18" />
          <path d="M12 22h8l-4 6z" />
          <path d="M13 9h6M13 13h6M13 17h6" />
        </Frame>
      );
    case 'wrench':
      return (
        <Frame>
          <path d="M9 23l11-11" />
          <path d="M18 4a6 6 0 0 0 5 10l-3-3 1-4z" />
          <path d="M8 22l2 2" />
        </Frame>
      );
    case 'gauge':
      return (
        <Frame>
          <circle cx="16" cy="14" r="8" />
          <path d="M16 14l4-4M12 26h8" />
        </Frame>
      );
    case 'micrometer':
      return (
        <Frame>
          <path d="M6 20V12h20v8" />
          <path d="M10 20v4M22 20v4" />
          <path d="M12 16h8" />
        </Frame>
      );
    case 'caliper':
      return (
        <Frame>
          <path d="M6 24L16 6l10 18" />
          <path d="M12 18h8" />
        </Frame>
      );
    case 'welding':
      return (
        <Frame>
          <path d="M8 24l10-10" />
          <path d="M18 8l6 6-3 3-6-6z" />
          <path d="M6 26h6" />
        </Frame>
      );
    case 'deburr':
      return (
        <Frame>
          <path d="M6 22h20" />
          <path d="M10 22l6-12 6 12" />
        </Frame>
      );
    case 'press':
      return (
        <Frame>
          <path d="M8 6h16v6H8z" />
          <path d="M16 12v8" />
          <path d="M10 26h12M16 20v6" />
        </Frame>
      );
    case 'consumable':
      return (
        <Frame>
          <rect x="9" y="8" width="14" height="18" rx="4" />
          <path d="M13 8V5h6v3" />
          <path d="M12 16h8" />
        </Frame>
      );
    default:
      return (
        <Frame>
          <circle cx="16" cy="16" r="9" />
          <path d="M16 11v10M11 16h10" />
        </Frame>
      );
  }
}

export function SpeakerGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 9v6h4l5 4V5L8 9z" />
      <path d="M16 8a5 5 0 0 1 0 8" />
      <path d="M19 5a9 9 0 0 1 0 14" />
    </svg>
  );
}

export function WarnGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3l9 17H3z" />
      <path d="M12 9v5M12 17.5v.5" />
    </svg>
  );
}
