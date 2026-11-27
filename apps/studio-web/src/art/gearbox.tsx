import {
  Arrow,
  ArrowLayer,
  Bolt,
  Callout,
  CheckMark,
  CrossMark,
  Dimension,
  Hole,
  INK,
  INK_SOFT,
  PAPER,
  Plate,
  Scene,
  Tag,
  TorqueArrow,
  Washer,
  makeToneResolver,
  type ArtProps,
} from './kit';

const BOLT_POSITIONS: ReadonlyArray<{ x: number; y: number }> = [
  { x: 132, y: 130 },
  { x: 240, y: 108 },
  { x: 348, y: 130 },
  { x: 348, y: 218 },
  { x: 240, y: 240 },
  { x: 132, y: 218 },
];

export function GearboxPartsArt({ highlight, arrows }: ArtProps) {
  const color = makeToneResolver(highlight);
  return (
    <Scene caption="Корпус редуктора и комплектация">
      <Callout x={240} y={30} text="Корпус РД-12 · всё разложено по ячейкам" anchor="middle" />
      <Plate x={78} y={62} width={190} height={150} radius={20} color={color('housing')} />
      <Hole cx={140} cy={128} r={30} color={INK_SOFT} centerLine />
      <Hole cx={212} cy={128} r={20} color={INK_SOFT} />
      <g stroke={INK_SOFT} strokeWidth={2}>
        <line x1={140} y1={98} x2={140} y2={158} strokeDasharray="5 5" />
      </g>
      <Tag x={86} y={234} text="корпус СЧ20" />
      <g stroke={color('parts')} strokeWidth={2.6} fill={PAPER}>
        <circle cx={316} cy={92} r={24} />
        <circle cx={316} cy={92} r={10} />
        <circle cx={376} cy={92} r={24} />
        <circle cx={376} cy={92} r={10} />
        <circle cx={316} cy={92} r={17} strokeDasharray="1 6" strokeWidth={6} />
      </g>
      <Callout x={296} y={140} text="2 подшипника 6204" size={13} color={INK_SOFT} />
      <g stroke={INK} strokeWidth={2.4} fill={PAPER}>
        <rect x={296} y={158} width={26} height={34} rx={6} />
        <rect x={336} y={158} width={26} height={34} rx={6} />
        <rect x={376} y={158} width={26} height={34} rx={6} />
        <rect x={296} y={206} width={26} height={34} rx={6} />
      </g>
      <Callout x={296} y={266} text="6 болтов М6 + 6 шайб" size={13} color={INK_SOFT} />
      <WeldCallout />
      <ArrowLayer arrows={arrows} />
    </Scene>
  );
}

function WeldCallout() {
  return (
    <g>
      <rect x={78} y={272} width={190} height={26} rx={13} fill="rgba(52,199,89,0.12)" />
      <text x={90} y={290} fontSize={13} fontWeight={600} fill="#1E9E45">
        трещин и забоин нет — можно собирать
      </text>
    </g>
  );
}

export function GearboxBearingArt({ highlight, arrows }: ArtProps) {
  const color = makeToneResolver(highlight);
  return (
    <Scene caption="Запрессовка подшипника по внутреннему кольцу">
      <Callout x={240} y={30} text="Усилие — только по внутреннему кольцу" anchor="middle" />
      <g>
        <Plate x={120} y={150} width={240} height={90} radius={10} color={color('housing', INK)} />
        <rect x={196} y={122} width={88} height={46} rx={8} fill={PAPER} stroke={color('bearing')} strokeWidth={3} />
        <circle cx={240} cy={145} r={17} fill={PAPER} stroke={color('bearing')} strokeWidth={2.6} />
        <g fill={color('bearing')}>
          <circle cx={240} cy={128} r={3.4} />
          <circle cx={258} cy={145} r={3.4} />
          <circle cx={240} cy={162} r={3.4} />
          <circle cx={222} cy={145} r={3.4} />
        </g>
      </g>
      <g stroke={color('mandrel')} strokeWidth={3.4} fill="none">
        <rect x={210} y={58} width={60} height={30} rx={6} fill={PAPER} />
        <line x1={240} y1={88} x2={240} y2={118} strokeWidth={9} strokeLinecap="round" />
      </g>
      <Arrow x1={352} y1={74} x2={352} y2={116} label="пресс 10 т" />
      <g stroke="#FF3B30" strokeWidth={3} strokeLinecap="round">
        <line x1={176} y1={126} x2={176} y2={160} />
        <line x1={170} y1={126} x2={182} y2={126} />
      </g>
      <CrossMark x={176} y={142} />
      <Callout x={60} y={196} text="по наружному кольцу — нельзя" size={13} color="#FF3B30" />
      <CheckMark x={400} y={104} />
      <Callout x={380} y={150} text="без перекоса" size={13} color="#1E9E45" />
      <ArrowLayer arrows={arrows} />
    </Scene>
  );
}

export function GearboxShaftArt({ highlight, arrows }: ArtProps) {
  const color = makeToneResolver(highlight);
  return (
    <Scene caption="Установка вала и сальников">
      <Callout x={240} y={30} text="Вал с подшипником — в корпус без ударов" anchor="middle" />
      <Plate x={120} y={96} width={230} height={150} radius={22} color={INK} />
      <Hole cx={196} cy={170} r={44} color={INK_SOFT} />
      <Hole cx={196} cy={170} r={26} color={color('bearing')} />
      <g stroke={color('shaft')} strokeWidth={10} strokeLinecap="round" fill="none">
        <line x1={196} y1={54} x2={196} y2={88} />
        <line x1={196} y1={212} x2={196} y2={246} />
      </g>
      <g transform="translate(196 246)" stroke={color('seal')} strokeWidth={3} fill={PAPER}>
        <rect x={-30} y={0} width={60} height={18} rx={5} />
        <line x1={-30} y1={9} x2={30} y2={9} strokeDasharray="4 4" strokeWidth={2} />
      </g>
      <Arrow x1={282} y1={120} x2={282} y2={158} label="без ударов" />
      <Callout x={300} y={112} text="Ø20 k6" size={13} color={INK_SOFT} />
      <Tag x={252} y={214} text="сальник 20×35×7" />
      <Callout x={300} y={288} text="кромка внутрь корпуса" size={13} color={INK_SOFT} />
      <ArrowLayer arrows={arrows} />
    </Scene>
  );
}

export function GearboxCoverArt({ highlight, arrows }: ArtProps) {
  const color = makeToneResolver(highlight);
  return (
    <Scene caption="Ориентация крышки редуктора">
      <Callout x={240} y={30} text="Метка «ВЕРХ» — совпадает с меткой корпуса" anchor="middle" />
      <Plate x={126} y={148} width={228} height={110} radius={26} color={INK} />
      <Plate x={150} y={86} width={180} height={52} radius={20} color={color('cover')} />
      <g stroke={color('cover')} strokeWidth={3} fill={PAPER}>
        <rect x={196} y={96} width={88} height={26} rx={13} />
      </g>
      <Tag x={196} y={80} text="ВЕРХ" color="#1E9E45" background="rgba(52,199,89,0.14)" />
      <g stroke="#FF3B30" strokeWidth={3.2} strokeLinecap="round">
        <line x1={344} y1={96} x2={356} y2={112} />
        <line x1={344} y1={112} x2={356} y2={96} />
      </g>
      <Callout x={364} y={110} text="не переворачивать" size={13} color="#FF3B30" />
      <g fill={PAPER} stroke={INK_SOFT} strokeWidth={2.6}>
        <rect x={142} y={132} width={196} height={10} rx={5} />
      </g>
      <Callout x={146} y={282} text="прокладка паронитовая под крышку" size={13} color={INK_SOFT} />
      <Arrow x1={240} y1={56} x2={240} y2={80} label="ставьте меткой вверх" />
      <ArrowLayer arrows={arrows} />
    </Scene>
  );
}

export function GearboxTorqueArt({ highlight, arrows }: ArtProps) {
  const color = makeToneResolver(highlight);
  return (
    <Scene caption="Затяжка болтов крест-накрест">
      <Callout x={240} y={30} text="Два прохода: 4 Н·м → 8±1 Н·м" anchor="middle" />
      <Plate x={64} y={62} width={352} height={210} radius={28} color={INK} />
      {BOLT_POSITIONS.map((position, index) => (
        <g key={index}>
          <Washer cx={position.x} cy={position.y} r={14} color={color('bolts', INK_SOFT)} />
          <Bolt x={position.x} y={position.y} size={13} color={color('bolts', INK_SOFT)} />
          <text x={position.x - 9} y={position.y - 20} fontSize={14} fontWeight={700} fill={color('numbers', INK_SOFT)}>
            {index + 1}
          </text>
        </g>
      ))}
      <g stroke="#007AFF" strokeWidth={2.2} strokeDasharray="6 6" fill="none">
        <path d="M 132 130 L 348 218 M 348 130 L 132 218 M 240 108 L 240 240" />
      </g>
      <TorqueArrow cx={240} cy={168} r={26} label="8±1 Н·м" />
      <ArrowLayer arrows={arrows} />
    </Scene>
  );
}

export function GearboxCheckArt({ highlight, arrows }: ArtProps) {
  const color = makeToneResolver(highlight);
  return (
    <Scene caption="Контроль вращения и осевого люфта">
      <Callout x={240} y={30} text="Вал вращается от руки — плавно, без хруста" anchor="middle" />
      <Plate x={96} y={84} width={288} height={168} radius={24} color={INK} />
      <Hole cx={240} cy={168} r={54} color={color('bearing', INK_SOFT)} />
      <g stroke={color('shaft')} strokeWidth={10} strokeLinecap="round">
        <line x1={240} y1={56} x2={240} y2={280} />
      </g>
      <TorqueArrow cx={300} cy={168} r={30} label="" />
      <Callout x={318} y={166} text="провернуть" size={13} color="#007AFF" />
      <g stroke={INK} strokeWidth={3} fill={PAPER}>
        <rect x={122} y={92} width={44} height={26} rx={5} />
        <line x1={144} y1={118} x2={144} y2={150} />
        <circle cx={144} cy={162} r={12} />
      </g>
      <Dimension x1={404} y1={142} x2={404} y2={194} label="≤0,10" vertical />
      <CheckMark x={392} y={266} />
      <Callout x={292} y={276} text="люфт ≤ 0,10 мм" size={13} color="#1E9E45" />
      <Callout x={112} y={282} text="подтёков масла нет" size={13} color={INK_SOFT} />
      <ArrowLayer arrows={arrows} />
    </Scene>
  );
}
