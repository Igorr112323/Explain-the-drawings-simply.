import type { ReactElement } from 'react';
import type { Highlight, StepIllustration } from '@ikguide/schema';
import { isKnownIllustration, type IllustrationId } from '../../art/ids';
import { CadAssemblyArt, GenericStepArt, type ArtProps } from '../../art/kit';
import {
  BracketBoreArt,
  BracketChamferArt,
  BracketDrillArt,
  BracketLayoutArt,
  BracketTapArt,
  BracketWeldArt,
} from '../../art/bracket';
import {
  GearboxBearingArt,
  GearboxCheckArt,
  GearboxCoverArt,
  GearboxPartsArt,
  GearboxShaftArt,
  GearboxTorqueArt,
} from '../../art/gearbox';

type ArtComponent = (props: ArtProps) => ReactElement;

const ART_REGISTRY: Readonly<Record<IllustrationId, ArtComponent>> = {
  'bracket-layout': BracketLayoutArt,
  'bracket-drill': BracketDrillArt,
  'bracket-tap': BracketTapArt,
  'bracket-bore': BracketBoreArt,
  'bracket-chamfer': BracketChamferArt,
  'bracket-weld': BracketWeldArt,
  'gearbox-parts': GearboxPartsArt,
  'gearbox-bearing': GearboxBearingArt,
  'gearbox-shaft': GearboxShaftArt,
  'gearbox-cover': GearboxCoverArt,
  'gearbox-torque': GearboxTorqueArt,
  'gearbox-check': GearboxCheckArt,
  'generic-step': GenericStepArt,
  'cad-assembly': CadAssemblyArt,
};

export function StepArt({ illustration, compact = false }: { illustration: StepIllustration; compact?: boolean }) {
  const Component = isKnownIllustration(illustration.illustrationId)
    ? ART_REGISTRY[illustration.illustrationId]
    : GenericStepArt;
  return (
    <div className={`art ${compact ? 'art-compact' : ''}`}>
      <Component highlight={illustration.highlight} arrows={illustration.arrows} />
    </div>
  );
}

export function HighlightLegend({ highlight }: { highlight: readonly Highlight[] }) {
  if (highlight.length === 0) {
    return null;
  }
  return (
    <ul className="legend">
      {highlight.map((item) => (
        <li key={item.shapeId} className={`legend-item legend-${item.tone}`}>
          <span className="legend-dot" aria-hidden="true" />
          <span>{item.label}</span>
        </li>
      ))}
    </ul>
  );
}
