import type { ReactNode } from 'react';
import type { ArtArrow, Highlight, HighlightTone } from '@ikguide/schema';

export const TONE_COLOR: Readonly<Record<HighlightTone, string>> = {
  accent: '#007AFF',
  danger: '#FF3B30',
  done: '#34C759',
};

export const INK = '#20242C';
export const INK_SOFT = '#6B7280';
export const MUTED = '#C7CBD4';
export const PAPER = '#FFFFFF';
export const WARNING = '#FFB020';

export const VIEW_BOX = { width: 480, height: 320 } as const;

export interface ArtProps {
  highlight: readonly Highlight[];
  arrows: readonly ArtArrow[];
}

export function makeToneResolver(highlight: readonly Highlight[]) {
  const map = new Map<string, HighlightTone>();
  highlight.forEach((item) => map.set(item.shapeId, item.tone));
  return (shapeId: string, base: string = INK): string => {
    const tone = map.get(shapeId);
    return tone ? TONE_COLOR[tone] : base;
  };
}

export function toneOf(highlight: readonly Highlight[], shapeId: string): HighlightTone | null {
  return highlight.find((item) => item.shapeId === shapeId)?.tone ?? null;
}

interface SceneProps {
  children: ReactNode;
  caption?: string;
}

export function Scene({ children, caption }: SceneProps) {
  return (
    <svg
      className="art-svg"
      viewBox={`0 0 ${VIEW_BOX.width} ${VIEW_BOX.height}`}
      role="img"
      aria-label={caption ?? 'Векторная схема шага'}
    >
      <defs>
        {(['accent', 'danger', 'done', 'ink'] as const).map((tone) => {
          const color = tone === 'ink' ? INK : TONE_COLOR[tone];
          return (
            <marker
              key={tone}
              id={`arrowhead-${tone}`}
              viewBox="0 0 10 10"
              refX="8"
              refY="5"
              markerWidth="7"
              markerHeight="7"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" fill={color} />
            </marker>
          );
        })}
        <pattern id="hatch" width="8" height="8" patternTransform="rotate(45)" patternUnits="userSpaceOnUse">
          <line x1="0" y1="0" x2="0" y2="8" stroke={MUTED} strokeWidth="1.6" />
        </pattern>
      </defs>
      {children}
    </svg>
  );
}

interface PlateProps {
  x: number;
  y: number;
  width: number;
  height: number;
  radius?: number;
  color?: string;
  fill?: string;
  dashed?: boolean;
  strokeWidth?: number;
}

export function Plate({ x, y, width, height, radius = 14, color = INK, fill = PAPER, dashed = false, strokeWidth = 3 }: PlateProps) {
  return (
    <rect
      x={x}
      y={y}
      width={width}
      height={height}
      rx={radius}
      fill={fill}
      stroke={color}
      strokeWidth={strokeWidth}
      strokeDasharray={dashed ? '9 7' : undefined}
    />
  );
}

interface HoleProps {
  cx: number;
  cy: number;
  r: number;
  color?: string;
  centerLine?: boolean;
  fill?: string;
}

export function Hole({ cx, cy, r, color = INK, centerLine = false, fill = PAPER }: HoleProps) {
  return (
    <g>
      <circle cx={cx} cy={cy} r={r} fill={fill} stroke={color} strokeWidth={2.6} />
      {centerLine ? (
        <g stroke={color} strokeWidth={1.4} strokeDasharray="6 4" opacity={0.75}>
          <line x1={cx - r - 12} y1={cy} x2={cx + r + 12} y2={cy} />
          <line x1={cx} y1={cy - r - 12} x2={cx} y2={cy + r + 12} />
        </g>
      ) : null}
    </g>
  );
}

interface BoltProps {
  x: number;
  y: number;
  color?: string;
  size?: number;
  nut?: boolean;
}

export function Bolt({ x, y, color = INK, size = 16, nut = false }: BoltProps) {
  const hex = Array.from({ length: 6 }, (_, index) => {
    const angle = (Math.PI / 3) * index - Math.PI / 6;
    return `${x + size * Math.cos(angle)},${y + size * Math.sin(angle)}`;
  }).join(' ');
  return (
    <g>
      <polygon points={hex} fill={PAPER} stroke={color} strokeWidth={2.4} />
      <circle cx={x} cy={y} r={size * 0.32} fill={PAPER} stroke={color} strokeWidth={1.8} />
      {nut ? null : <line x1={x} y1={y + size} x2={x} y2={y + size * 2.4} stroke={color} strokeWidth={2.4} />}
    </g>
  );
}

interface WasherProps {
  cx: number;
  cy: number;
  r?: number;
  color?: string;
}

export function Washer({ cx, cy, r = 10, color = INK }: WasherProps) {
  return (
    <g>
      <circle cx={cx} cy={cy} r={r} fill={PAPER} stroke={color} strokeWidth={2.4} />
      <circle cx={cx} cy={cy} r={r * 0.5} fill={PAPER} stroke={color} strokeWidth={2} />
    </g>
  );
}

interface ArrowProps {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color?: string;
  label?: string;
  labelColor?: string;
  width?: number;
  dashed?: boolean;
  marker?: 'accent' | 'danger' | 'done' | 'ink';
}

export function Arrow({ x1, y1, x2, y2, color = '#007AFF', label, labelColor, width = 3, dashed = false, marker = 'accent' }: ArrowProps) {
  const midX = (x1 + x2) / 2;
  const midY = (y1 + y2) / 2;
  return (
    <g>
      <line
        x1={x1}
        y1={y1}
        x2={x2}
        y2={y2}
        stroke={color}
        strokeWidth={width}
        strokeDasharray={dashed ? '7 6' : undefined}
        markerEnd={`url(#arrowhead-${marker})`}
      />
      {label ? (
        <text x={midX + 10} y={midY - 8} fontSize={15} fontWeight={600} fill={labelColor ?? color}>
          {label}
        </text>
      ) : null}
    </g>
  );
}

interface DimensionProps {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  label: string;
  color?: string;
  vertical?: boolean;
}

export function Dimension({ x1, y1, x2, y2, label, color = INK_SOFT, vertical = false }: DimensionProps) {
  const tick = 7;
  const midX = (x1 + x2) / 2;
  const midY = (y1 + y2) / 2;
  return (
    <g stroke={color} strokeWidth={1.4} fill={color}>
      <line x1={x1} y1={y1} x2={x2} y2={y2} markerStart="url(#arrowhead-ink)" markerEnd="url(#arrowhead-ink)" />
      {vertical ? (
        <g>
          <line x1={x1 - tick} y1={y1} x2={x1 + tick} y2={y1} />
          <line x1={x2 - tick} y1={y2} x2={x2 + tick} y2={y2} />
          <text x={midX - 14} y={midY} fontSize={16} fontWeight={600} transform={`rotate(-90 ${midX - 14} ${midY})`} textAnchor="middle" stroke="none">
            {label}
          </text>
        </g>
      ) : (
        <g>
          <line x1={x1} y1={y1 - tick} x2={x1} y2={y1 + tick} />
          <line x1={x2} y1={y2 - tick} x2={x2} y2={y2 + tick} />
          <text x={midX} y={midY - 10} fontSize={16} fontWeight={600} textAnchor="middle" stroke="none">
            {label}
          </text>
        </g>
      )}
    </g>
  );
}

interface CalloutProps {
  x: number;
  y: number;
  text: string;
  color?: string;
  anchor?: 'start' | 'middle' | 'end';
  size?: number;
}

export function Callout({ x, y, text, color = INK, anchor = 'start', size = 16 }: CalloutProps) {
  return (
    <text x={x} y={y} fontSize={size} fontWeight={600} fill={color} textAnchor={anchor}>
      {text}
    </text>
  );
}

interface TagProps {
  x: number;
  y: number;
  text: string;
  color?: string;
  background?: string;
}

export function Tag({ x, y, text, color = INK, background = '#F2F4F8' }: TagProps) {
  const width = text.length * 8.6 + 22;
  return (
    <g>
      <rect x={x} y={y - 15} width={width} height={26} rx={13} fill={background} stroke="none" />
      <text x={x + 11} y={y + 3} fontSize={14} fontWeight={600} fill={color}>
        {text}
      </text>
    </g>
  );
}

export function CheckMark({ x, y, color = '#34C759', size = 18 }: { x: number; y: number; color?: string; size?: number }) {
  return (
    <path
      d={`M ${x - size} ${y} L ${x - size * 0.25} ${y + size * 0.7} L ${x + size} ${y - size * 0.8}`}
      fill="none"
      stroke={color}
      strokeWidth={3.4}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  );
}

/** Standalone check icon for HTML contexts (badges, checkboxes) — must be a full <svg>, not a bare <path>. */
export function CheckIcon({ size = 16, color = 'currentColor' }: { size?: number; color?: string }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke={color} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 12.5L10 17.5L19 6.5" />
    </svg>
  );
}

export function CrossMark({ x, y, color = '#FF3B30', size = 16 }: { x: number; y: number; color?: string; size?: number }) {
  return (
    <g stroke={color} strokeWidth={3.4} strokeLinecap="round">
      <line x1={x - size} y1={y - size} x2={x + size} y2={y + size} />
      <line x1={x + size} y1={y - size} x2={x - size} y2={y + size} />
    </g>
  );
}

interface WeldSeamProps {
  x: number;
  y: number;
  length: number;
  angle?: number;
  color?: string;
  leg?: number;
}

/** IKEA-like fillet weld triangle with a weld symbol. */
export function WeldSeam({ x, y, length, angle = 0, color = '#FF3B30', leg = 12 }: WeldSeamProps) {
  return (
    <g transform={`translate(${x} ${y}) rotate(${angle})`}>
      <path d={`M 0 0 L ${length} 0 L ${length} ${leg} Z`} fill="none" stroke={color} strokeWidth={2.6} />
      <line x1={0} y1={0} x2={length} y2={0} stroke={color} strokeWidth={6} strokeLinecap="round" />
    </g>
  );
}

export function SurfaceMark({ x, y, label, color = INK_SOFT }: { x: number; y: number; label: string; color?: string }) {
  return (
    <g>
      <path d={`M ${x} ${y} L ${x + 18} ${y - 26} L ${x + 26} ${y} Z`} fill="none" stroke={color} strokeWidth={1.8} />
      <line x1={x + 14} y1={y - 26} x2={x + 44} y2={y - 26} stroke={color} strokeWidth={1.8} />
      <text x={x + 49} y={y - 20} fontSize={15} fontWeight={600} fill={color}>
        {label}
      </text>
    </g>
  );
}

export function ArrowLayer({ arrows }: { arrows: readonly ArtArrow[] }) {
  return (
    <g>
      {arrows.map((arrow, index) => {
        const x1 = (arrow.fromX / 100) * VIEW_BOX.width;
        const y1 = (arrow.fromY / 100) * VIEW_BOX.height;
        const x2 = (arrow.toX / 100) * VIEW_BOX.width;
        const y2 = (arrow.toY / 100) * VIEW_BOX.height;
        return <Arrow key={`${arrow.fromX}-${arrow.fromY}-${index}`} x1={x1} y1={y1} x2={x2} y2={y2} label={arrow.label} />;
      })}
    </g>
  );
}

/** Circled torque arrow with a torque value. */
export function TorqueArrow({ cx, cy, r, label, color = '#007AFF' }: { cx: number; cy: number; r: number; label: string; color?: string }) {
  return (
    <g>
      <path
        d={`M ${cx - r} ${cy} A ${r} ${r} 0 1 1 ${cx + r} ${cy}`}
        fill="none"
        stroke={color}
        strokeWidth={3}
        markerEnd="url(#arrowhead-accent)"
      />
      <text x={cx} y={cy + r + 26} fontSize={17} fontWeight={700} fill={color} textAnchor="middle">
        {label}
      </text>
    </g>
  );
}

export function GenericStepArt({ highlight, arrows }: ArtProps) {
  const color = makeToneResolver(highlight);
  return (
    <Scene caption="Общая схема шага">
      <Plate x={70} y={70} width={340} height={180} color={color('plate')} />
      <Hole cx={140} cy={160} r={18} color={color('hole')} />
      <Hole cx={340} cy={160} r={18} color={color('hole')} />
      <Dimension x1={70} y1={286} x2={410} y2={286} label="размер по чертежу" />
      <Callout x={240} y={130} text="Схема появится после привязки" anchor="middle" color={INK_SOFT} size={15} />
      <ArrowLayer arrows={arrows} />
    </Scene>
  );
}

/** Isometric box used by the 3D fallback art (no WebGL, no network). */
function IsoBox({
  x,
  y,
  width,
  depth,
  height,
  color = INK,
  fill = PAPER,
  sideFill = '#F2F4F7',
}: {
  x: number;
  y: number;
  width: number;
  depth: number;
  height: number;
  color?: string;
  fill?: string;
  sideFill?: string;
}) {
  const dx = depth * 0.6;
  const dy = depth * 0.42;
  return (
    <g stroke={color} strokeWidth={2.4} strokeLinejoin="round">
      {/* top face */}
      <polygon
        points={`${x},${y} ${x + dx},${y - dy} ${x + dx + width},${y - dy} ${x + width},${y}`}
        fill={fill}
      />
      {/* front face */}
      <polygon points={`${x},${y} ${x + width},${y} ${x + width},${y + height} ${x},${y + height}`} fill={sideFill} />
      {/* right face */}
      <polygon
        points={`${x + width},${y} ${x + width + dx},${y - dy} ${x + width + dx},${y - dy + height} ${x + width},${y + height}`}
        fill={sideFill}
      />
    </g>
  );
}

/**
 * Fallback art for steps that came from a 3D assembly but have no rendered IKEA diagram yet
 * (for example right after a merge). Deliberately flat: same three colours as the SVG renderer.
 */
export function CadAssemblyArt({ highlight, arrows }: ArtProps) {
  const color = makeToneResolver(highlight);
  const active = toneOf(highlight, 'active') ? TONE_COLOR.accent : color('active');
  return (
    <Scene caption="Изометрическая схема 3D-сборки">
      <IsoBox x={90} y={190} width={250} depth={70} height={40} color={color('base')} />
      <IsoBox x={140} y={158} width={140} depth={40} height={22} color={color('cover')} sideFill="#F2F4F7" />
      <g opacity={0.9}>
        <IsoBox x={300} y={96} width={54} depth={22} height={30} color={active} fill="#E8F2FF" sideFill="#E8F2FF" />
      </g>
      <Arrow x1={252} y1={150} x2={330} y2={86} color={active} label="по оси сборки" marker="accent" />
      <Callout x={90} y={282} text="Деталь выделена синим · остальное уже установлено" anchor="start" color={INK_SOFT} size={14} />
      <ArrowLayer arrows={arrows} />
    </Scene>
  );
}
