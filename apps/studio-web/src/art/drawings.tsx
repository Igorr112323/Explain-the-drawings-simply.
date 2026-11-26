import type { ReactNode } from 'react';

const DRAWING_INK = '#1B1E26';
const DRAWING_SOFT = '#69707F';
const DRAWING_LINE = '#B9BEC9';
const SHEET = '#FFFFFF';

interface DrawingSheetProps {
  viewId: string;
  compact?: boolean;
}

function TitleBlock({ code, name, material, scale }: { code: string; name: string; material: string; scale: string }) {
  return (
    <g>
      <rect x={690} y={470} width={276} height={134} fill={SHEET} stroke={DRAWING_INK} strokeWidth={1.6} />
      <line x1={690} y1={516} x2={966} y2={516} stroke={DRAWING_INK} strokeWidth={1.2} />
      <line x1={690} y1={556} x2={966} y2={556} stroke={DRAWING_INK} strokeWidth={1.2} />
      <line x1={690} y1={582} x2={966} y2={582} stroke={DRAWING_INK} strokeWidth={1.2} />
      <line x1={830} y1={516} x2={830} y2={604} stroke={DRAWING_INK} strokeWidth={1.2} />
      <line x1={848} y1={556} x2={848} y2={604} stroke={DRAWING_INK} strokeWidth={1.2} />
      <text x={702} y={505} fontSize={19} fontWeight={700} fill={DRAWING_INK} fontFamily="ui-monospace, monospace">
        {code}
      </text>
      <text x={702} y={542} fontSize={14} fill={DRAWING_INK}>
        {name}
      </text>
      <text x={702} y={573} fontSize={12} fill={DRAWING_SOFT}>
        {material}
      </text>
      <text x={702} y={595} fontSize={12} fill={DRAWING_SOFT}>
        Масштаб {scale}
      </text>
      <text x={858} y={573} fontSize={12} fill={DRAWING_SOFT}>
        Лист 1/1
      </text>
      <text x={858} y={595} fontSize={12} fill={DRAWING_SOFT}>
        ГОСТ 2.104
      </text>
    </g>
  );
}

function SheetFrame({ children }: { children: ReactNode }) {
  return (
    <g>
      <rect x={18} y={18} width={964} height={604} fill={SHEET} stroke={DRAWING_INK} strokeWidth={2.4} />
      <rect x={34} y={34} width={932} height={572} fill="none" stroke={DRAWING_LINE} strokeWidth={1} />
      {children}
    </g>
  );
}

export function BracketDrawingSheet({ viewId }: DrawingSheetProps) {
  return (
    <svg className="sheet-svg" viewBox="0 0 1000 640" role="img" aria-label={`Чертёж ${viewId}`}>
      <SheetFrame>
        <g stroke={DRAWING_INK} strokeWidth={3} fill={SHEET}>
          <rect x={180} y={140} width={640} height={340} rx={18} />
        </g>
        {/* Rib (косынка) */}
        <path d="M 180 140 L 74 140 L 180 300 Z" fill="#F4F5F8" stroke={DRAWING_INK} strokeWidth={3} />

        {/* Central bore Ø20 H7 */}
        <g stroke={DRAWING_INK} strokeWidth={2.6} fill={SHEET}>
          <circle cx={560} cy={310} r={54} />
        </g>
        <g stroke={DRAWING_SOFT} strokeWidth={1} strokeDasharray="12 6 3 6">
          <line x1={482} y1={310} x2={638} y2={310} />
          <line x1={560} y1={232} x2={560} y2={388} />
        </g>

        {/* Four M8 holes */}
        {[
          { cx: 250, cy: 200 },
          { cx: 250, cy: 420 },
          { cx: 760, cy: 200 },
          { cx: 760, cy: 420 },
        ].map((hole, index) => (
          <g key={index} stroke={DRAWING_INK} strokeWidth={2.2} fill={SHEET}>
            <circle cx={hole.cx} cy={hole.cy} r={16} />
            <circle cx={hole.cx} cy={hole.cy} r={9} strokeDasharray="3 3" strokeWidth={1.2} />
            <line x1={hole.cx - 26} y1={hole.cy} x2={hole.cx + 26} y2={hole.cy} strokeWidth={0.9} stroke={DRAWING_SOFT} />
            <line x1={hole.cx} y1={hole.cy - 26} x2={hole.cx} y2={hole.cy + 26} strokeWidth={0.9} stroke={DRAWING_SOFT} />
          </g>
        ))}

        {/* Dimensions */}
        <g stroke={DRAWING_SOFT} strokeWidth={1.1} fill={DRAWING_SOFT}>
          <line x1={180} y1={520} x2={820} y2={520} markerStart="url(#dim-arrow)" markerEnd="url(#dim-arrow)" />
          <line x1={180} y1={500} x2={180} y2={540} />
          <line x1={820} y1={500} x2={820} y2={540} />
          <text x={500} y={512} fontSize={17} textAnchor="middle" stroke="none">
            120
          </text>

          <line x1={864} y1={140} x2={864} y2={480} markerStart="url(#dim-arrow)" markerEnd="url(#dim-arrow)" />
          <line x1={846} y1={140} x2={882} y2={140} />
          <line x1={846} y1={480} x2={882} y2={480} />
          <text x={886} y={316} fontSize={17} textAnchor="middle" stroke="none">
            80
          </text>
        </g>

        {/* Leaders */}
        <g stroke={DRAWING_INK} strokeWidth={1.1} fill={DRAWING_INK}>
          <line x1={620} y1={268} x2={700} y2={214} />
          <circle cx={620} cy={268} r={3} stroke="none" />
          <text x={704} y={210} fontSize={17} stroke="none" fontFamily="ui-monospace, monospace">
            Ø20 H7
          </text>

          <line x1={250} y1={176} x2={182} y2={112} />
          <text x={96} y={106} fontSize={16} stroke="none" fontFamily="ui-monospace, monospace">
            4 отв. М8-7H
          </text>
          <text x={96} y={126} fontSize={13} fill={DRAWING_SOFT} stroke="none">
            глуб. 20
          </text>

          <line x1={132} y1={214} x2={70} y2={256} />
          <text x={52} y={274} fontSize={15} stroke="none" fontFamily="ui-monospace, monospace">
            Т1-К5
          </text>
        </g>

        {/* Chamfer and roughness */}
        <g fill={DRAWING_SOFT} fontSize={15} fontFamily="ui-monospace, monospace">
          <text x={604} y={252}>2×45°</text>
          <text x={596} y={392}>Ra 1.6</text>
        </g>
        <g stroke={DRAWING_SOFT} strokeWidth={1.2} fill="none">
          <path d="M 604 244 L 616 220 L 628 244 Z" />
          <line x1={616} y1={220} x2={660} y2={220} />
          <path d="M 596 386 L 608 402 L 620 386" />
        </g>

        {/* Free dimension 18 with a question */}
        <g stroke={DRAWING_SOFT} strokeWidth={1.1} fill={DRAWING_SOFT}>
          <line x1={360} y1={190} x2={430} y2={190} markerStart="url(#dim-arrow)" markerEnd="url(#dim-arrow)" />
          <line x1={360} y1={172} x2={360} y2={208} />
          <line x1={430} y1={172} x2={430} y2={208} />
          <text x={395} y={182} fontSize={16} textAnchor="middle" stroke="none">
            18
          </text>
        </g>

        <TitleBlock code="КС-04.100.000 СБ" name="Кронштейн сервопривода" material="Сталь 09Г2С ГОСТ 19281" scale="1:1" />

        <defs>
          <marker id="dim-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill={DRAWING_SOFT} />
          </marker>
        </defs>
      </SheetFrame>
    </svg>
  );
}

export function GearboxDrawingSheet({ viewId }: DrawingSheetProps) {
  return (
    <svg className="sheet-svg" viewBox="0 0 1000 640" role="img" aria-label={`Чертёж ${viewId}`}>
      <SheetFrame>
        {/* Housing section */}
        <g stroke={DRAWING_INK} strokeWidth={3} fill={SHEET}>
          <path d="M 190 130 L 780 130 L 780 500 L 190 500 Z" />
        </g>
        <g stroke={DRAWING_LINE} strokeWidth={1} fill="none">
          {Array.from({ length: 14 }, (_, index) => (
            <line key={index} x1={196 + index * 44} y1={136} x2={166 + index * 44} y2={166} />
          ))}
        </g>

        {/* Bore and bearing seats */}
        <g stroke={DRAWING_INK} strokeWidth={3} fill={SHEET}>
          <circle cx={500} cy={330} r={70} />
          <circle cx={500} cy={330} r={52} strokeWidth={2} />
        </g>
        <g stroke={DRAWING_SOFT} strokeWidth={1} strokeDasharray="14 6 3 6">
          <line x1={380} y1={330} x2={620} y2={330} />
          <line x1={500} y1={210} x2={500} y2={450} />
        </g>

        {/* Bearing hatches */}
        <g stroke={DRAWING_INK} strokeWidth={2.2} fill={SHEET}>
          <rect x={452} y={250} width={96} height={20} />
          <rect x={452} y={390} width={96} height={20} />
        </g>
        <g stroke={DRAWING_SOFT} strokeWidth={1}>
          {Array.from({ length: 6 }, (_, index) => (
            <line key={index} x1={454 + index * 16} y1={252} x2={442 + index * 16} y2={268} />
          ))}
          {Array.from({ length: 6 }, (_, index) => (
            <line key={`b-${index}`} x1={454 + index * 16} y1={392} x2={442 + index * 16} y2={408} />
          ))}
        </g>

        {/* Cover and split line */}
        <line x1={190} y1={212} x2={780} y2={212} stroke={DRAWING_INK} strokeWidth={2.4} />
        <g stroke={DRAWING_SOFT} strokeWidth={1.2} strokeDasharray="10 6">
          <line x1={190} y1={206} x2={780} y2={206} />
        </g>

        {/* Six M6 holes around the cover */}
        {[
          { cx: 260, cy: 160 },
          { cx: 500, cy: 148 },
          { cx: 720, cy: 160 },
          { cx: 720, cy: 466 },
          { cx: 500, cy: 478 },
          { cx: 260, cy: 466 },
        ].map((hole, index) => (
          <g key={index} stroke={DRAWING_INK} strokeWidth={2} fill={SHEET}>
            <circle cx={hole.cx} cy={hole.cy} r={13} />
            <circle cx={hole.cx} cy={hole.cy} r={7} strokeDasharray="2 2" strokeWidth={1} />
          </g>
        ))}

        {/* Dimensions */}
        <g stroke={DRAWING_SOFT} strokeWidth={1.1} fill={DRAWING_SOFT}>
          <line x1={190} y1={544} x2={780} y2={544} markerStart="url(#dim-arrow)" markerEnd="url(#dim-arrow)" />
          <line x1={190} y1={526} x2={190} y2={562} />
          <line x1={780} y1={526} x2={780} y2={562} />
          <text x={485} y={536} fontSize={16} textAnchor="middle" stroke="none">
            180
          </text>
        </g>

        {/* Leaders */}
        <g stroke={DRAWING_INK} strokeWidth={1.1} fill={DRAWING_INK}>
          <line x1={556} y1={300} x2={640} y2={246} />
          <circle cx={556} cy={300} r={3} />
          <text x={644} y={242} fontSize={17} stroke="none" fontFamily="ui-monospace, monospace">
            Ø32 H7/k6
          </text>

          <line x1={260} y1={146} x2={206} y2={94} />
          <text x={110} y={88} fontSize={15} stroke="none" fontFamily="ui-monospace, monospace">
            6 отв. М6-7H
          </text>

          <line x1={716} y1={474} x2={806} y2={430} />
          <text x={756} y={420} fontSize={15} stroke="none" fontFamily="ui-monospace, monospace">
            4 отв. Ø6,5
          </text>
        </g>

        <g fill={DRAWING_SOFT} fontSize={15} fontFamily="ui-monospace, monospace">
          <text x={584} y={470}>Ra 0.8</text>
          <text x={586} y={282}>2×45°</text>
        </g>
        <g stroke={DRAWING_SOFT} strokeWidth={1.2} fill="none">
          <path d="M 584 462 L 596 440 L 608 462 Z" />
          <line x1={596} y1={440} x2={638} y2={440} />
        </g>

        {/* Section marker */}
        <g stroke={DRAWING_INK} strokeWidth={2} fill={DRAWING_INK}>
          <text x={176} y={330} fontSize={16} fontFamily="ui-monospace, monospace">
            А–А
          </text>
          <line x1={152} y1={260} x2={152} y2={400} strokeDasharray="14 6 3 6" strokeWidth={1.2} />
        </g>

        <TitleBlock code="РД-12.200.000 СБ" name="Корпус редуктора в сборе" material="СЧ20 ГОСТ 1412-85" scale="1:2" />

        <defs>
          <marker id="dim-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill={DRAWING_SOFT} />
          </marker>
        </defs>
      </SheetFrame>
    </svg>
  );
}

export function GenericDrawingSheet({ viewId }: DrawingSheetProps) {
  return (
    <svg className="sheet-svg" viewBox="0 0 1000 640" role="img" aria-label={`Чертёж ${viewId}`}>
      <SheetFrame>
        <rect x={150} y={120} width={700} height={380} rx={12} fill="#F7F8FA" stroke={DRAWING_LINE} strokeWidth={2} strokeDasharray="12 10" />
        <text x={500} y={300} fontSize={26} textAnchor="middle" fill={DRAWING_SOFT}>
          Чертёж не привязан
        </text>
        <text x={500} y={338} fontSize={17} textAnchor="middle" fill={DRAWING_LINE}>
          Загрузите скан или привяжите разметку в режиме инженера
        </text>
        <TitleBlock code={viewId} name="Без названия" material="—" scale="—" />
      </SheetFrame>
    </svg>
  );
}

export function DrawingSheet({ viewId, compact = false }: DrawingSheetProps) {
  const sheet =
    viewId === 'bracket-sheet' ? (
      <BracketDrawingSheet viewId={viewId} />
    ) : viewId === 'gearbox-sheet' ? (
      <GearboxDrawingSheet viewId={viewId} />
    ) : (
      <GenericDrawingSheet viewId={viewId} />
    );
  return <div className={`sheet ${compact ? 'sheet-compact' : ''}`}>{sheet}</div>;
}
