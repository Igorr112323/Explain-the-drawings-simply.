import {
  Arrow,
  ArrowLayer,
  Callout,
  Dimension,
  Hole,
  INK,
  INK_SOFT,
  MUTED,
  PAPER,
  Plate,
  Scene,
  SurfaceMark,
  Tag,
  WeldSeam,
  makeToneResolver,
  type ArtProps,
} from './kit';

const HOLES: ReadonlyArray<{ cx: number; cy: number }> = [
  { cx: 150, cy: 128 },
  { cx: 150, cy: 218 },
  { cx: 350, cy: 128 },
  { cx: 350, cy: 218 },
];

export function BracketLayoutArt({ highlight, arrows }: ArtProps) {
  const color = makeToneResolver(highlight);
  return (
    <Scene caption="Заготовка кронштейна с разметкой баз">
      <Callout x={240} y={34} text="Заготовка 120 × 80 × 12" anchor="middle" />
      <Plate x={90} y={68} width={300} height={170} color={color('plate')} />
      {HOLES.map((hole, index) => (
        <Hole key={index} cx={hole.cx} cy={hole.cy} r={12} color={color('holes', INK_SOFT)} centerLine />
      ))}
      <g stroke={color('base', '#34C759')} strokeWidth={3} strokeDasharray="8 6">
        <line x1={80} y1={248} x2={400} y2={248} />
      </g>
      <Tag x={96} y={282} text="База А — длинная кромка" color={color('base', '#34C759')} background="rgba(52,199,89,0.10)" />
      <g stroke={color('rib', MUTED)} strokeWidth={2.6} strokeDasharray="8 6" fill="none">
        <path d="M 90 68 L 34 68 L 90 150 Z" />
      </g>
      <Callout x={16} y={60} text="косынка" size={13} color={INK_SOFT} />
      <Dimension x1={90} y1={266} x2={390} y2={266} label="120" />
      <Dimension x1={416} y1={68} x2={416} y2={238} label="80" vertical />
      <ArrowLayer arrows={arrows} />
    </Scene>
  );
}

export function BracketDrillArt({ highlight, arrows }: ArtProps) {
  const color = makeToneResolver(highlight);
  return (
    <Scene caption="Сверление четырёх отверстий под резьбу М8">
      <Callout x={240} y={30} text="Сверло Ø6,8 — 4 отверстия" anchor="middle" />
      <Plate x={90} y={88} width={300} height={180} color={INK} />
      {HOLES.map((hole, index) => (
        <Hole key={index} cx={hole.cx} cy={hole.cy} r={10} color={color('holes', INK)} fill={index === 0 ? 'rgba(0,122,255,0.10)' : PAPER} />
      ))}
      <g stroke={color('drill')} strokeWidth={3.2} fill="none">
        <line x1={150} y1={52} x2={150} y2={104} />
        <path d="M 140 52 L 150 62 L 160 52" />
        <path d="M 141 76 L 159 82 M 141 88 L 159 94" strokeWidth={2} />
        <path d="M 143 108 L 150 122 L 157 108 Z" fill={PAPER} />
      </g>
      <Arrow x1={196} y1={92} x2={162} y2={116} label="Ø6,8" />
      <Dimension x1={382} y1={118} x2={382} y2={150} label="24" vertical />
      <Callout x={330} y={196} text="глубина 24 мм" size={13} color={INK_SOFT} />
      <g fill={MUTED}>
        <circle cx={132} cy={252} r={3} />
        <circle cx={122} cy={244} r={2.4} />
        <circle cx={144} cy={258} r={2} />
      </g>
      <Callout x={104} y={286} text="стружку не оставлять в отверстии" size={13} color={INK_SOFT} />
      <ArrowLayer arrows={arrows} />
    </Scene>
  );
}

export function BracketTapArt({ highlight, arrows }: ArtProps) {
  const color = makeToneResolver(highlight);
  return (
    <Scene caption="Нарезание резьбы М8 метчиком">
      <Callout x={240} y={28} text="Метчик №1, затем №2 — М8-7H" anchor="middle" />
      <Plate x={70} y={132} width={340} height={140} color={INK} />
      {HOLES.map((hole, index) => (
        <Hole key={index} cx={hole.cx} cy={hole.cy} r={9} color={color('holes')} />
      ))}
      <g stroke={color('tap')} strokeWidth={3} fill="none">
        <line x1={150} y1={40} x2={150} y2={126} />
        <line x1={110} y1={40} x2={190} y2={40} strokeWidth={7} strokeLinecap="round" />
        <g strokeWidth={2}>
          <line x1={142} y1={78} x2={158} y2={72} />
          <line x1={142} y1={92} x2={158} y2={86} />
          <line x1={142} y1={106} x2={158} y2={100} />
        </g>
      </g>
      <Arrow x1={228} y1={72} x2={262} y2={72} label="1 оборот вперёд" />
      <Arrow x1={262} y1={104} x2={228} y2={104} label="½ назад" color="#FF3B30" marker="danger" />
      <Tag x={286} y={168} text="4 отверстия" background="rgba(0,122,255,0.10)" color="#007AFF" />
      <Callout x={86} y={300} text="СОЖ обязательна · продуть отверстия" size={13} color={INK_SOFT} />
      <ArrowLayer arrows={arrows} />
    </Scene>
  );
}

export function BracketBoreArt({ highlight, arrows }: ArtProps) {
  const color = makeToneResolver(highlight);
  return (
    <Scene caption="Развёртывание отверстия Ø20 H7">
      <Callout x={240} y={28} text="Развёртка Ø20 H7 — только вперёд" anchor="middle" />
      <Plate x={80} y={96} width={320} height={180} color={INK} />
      <Hole cx={240} cy={186} r={42} color={color('bore')} fill="rgba(0,122,255,0.08)" centerLine />
      <g stroke={color('reamer')} strokeWidth={3} fill="none">
        <line x1={240} y1={36} x2={240} y2={140} />
        <rect x={226} y={36} width={28} height={22} rx={5} fill={PAPER} />
        <g strokeWidth={2}>
          <line x1={232} y1={82} x2={248} y2={76} />
          <line x1={232} y1={96} x2={248} y2={90} />
          <line x1={232} y1={110} x2={248} y2={104} />
          <line x1={232} y1={124} x2={248} y2={118} />
        </g>
      </g>
      <Arrow x1={300} y1={150} x2={300} y2={112} label="подача" />
      <Dimension x1={272} y1={186} x2={430} y2={186} label="Ø20 H7" />
      <SurfaceMark x={104} y={262} label="Ra 1.6" />
      <Callout x={240} y={304} text="20,000…20,021 мм — контроль калибром-пробкой" anchor="middle" size={13} color={INK_SOFT} />
      <ArrowLayer arrows={arrows} />
    </Scene>
  );
}

export function BracketChamferArt({ highlight, arrows }: ArtProps) {
  const color = makeToneResolver(highlight);
  return (
    <Scene caption="Фаски 2×45° на отверстии">
      <Callout x={240} y={30} text="Фаска 2×45° с двух сторон" anchor="middle" />
      <g>
        <circle cx={240} cy={168} r={84} fill={PAPER} stroke={INK} strokeWidth={3.4} />
        <circle cx={240} cy={168} r={62} fill={PAPER} stroke={color('bore', INK)} strokeWidth={3} />
        <g stroke={color('chamfer')} strokeWidth={3} fill="none">
          <path d="M 178 108 L 196 92 L 214 106" />
          <path d="M 266 230 L 284 246 L 302 230" />
        </g>
        <g stroke={INK_SOFT} strokeWidth={1.4} strokeDasharray="5 5">
          <line x1={240} y1={60} x2={240} y2={276} />
          <line x1={132} y1={168} x2={348} y2={168} />
        </g>
      </g>
      <Arrow x1={150} y1={72} x2={186} y2={100} label="2×45°" />
      <Arrow x1={330} y1={266} x2={296} y2={238} label="2×45°" />
      <g stroke="#FF3B30" strokeWidth={3.4} strokeLinecap="round">
        <line x1={352} y1={124} x2={372} y2={144} />
        <line x1={372} y1={124} x2={352} y2={144} />
      </g>
      <Callout x={354} y={166} text="заусенец" size={13} color="#FF3B30" />
      <Callout x={240} y={306} text="острая кромка = брак и порез" anchor="middle" size={13} color={INK_SOFT} />
      <ArrowLayer arrows={arrows} />
    </Scene>
  );
}

export function BracketWeldArt({ highlight, arrows }: ArtProps) {
  const color = makeToneResolver(highlight);
  return (
    <Scene caption="Приварка косынки тавровым швом Т1-К5">
      <Callout x={240} y={28} text="Шов Т1-К5 — катет 5 мм" anchor="middle" />
      <Plate x={180} y={70} width={44} height={210} radius={6} color={INK} />
      <Plate x={90} y={228} width={300} height={40} radius={6} color={INK} />
      <g fill={PAPER} stroke={color('rib', INK)} strokeWidth={3}>
        <path d="M 224 228 L 300 228 L 224 156 Z" />
      </g>
      <WeldSeam x={224} y={158} length={70} angle={-45} color={color('weld', '#FF3B30')} />
      <WeldSeam x={182} y={228} length={70} angle={0} color={color('weld', '#FF3B30')} />
      <g stroke={INK} strokeWidth={3} fill={PAPER}>
        <line x1={356} y1={74} x2={300} y2={130} />
        <rect x={348} y={56} width={20} height={26} rx={4} />
      </g>
      <g stroke="#FFB020" strokeWidth={2.4} strokeLinecap="round">
        <line x1={292} y1={126} x2={282} y2={112} />
        <line x1={288} y1={138} x2={274} y2={134} />
        <line x1={296} y1={146} x2={290} y2={160} />
      </g>
      <Tag x={64} y={92} text="электрод Ø3 · 80–110 А" background="rgba(255,59,48,0.08)" color="#FF3B30" />
      <Callout x={62} y={196} text="косынка" size={13} color={INK_SOFT} />
      <Arrow x1={150} y1={176} x2={196} y2={204} label="Т1-К5" color="#FF3B30" marker="danger" />
      <Callout x={240} y={306} text="после сварки: шлак, брызги, контроль УШС-3" anchor="middle" size={13} color={INK_SOFT} />
      <ArrowLayer arrows={arrows} />
    </Scene>
  );
}
