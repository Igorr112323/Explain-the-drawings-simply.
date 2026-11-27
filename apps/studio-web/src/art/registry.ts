import type { ReactElement } from 'react';
import type { StepIllustration } from '@ikguide/schema';
import { isKnownIllustration, type IllustrationId } from './ids';
import { GenericStepArt, type ArtProps } from './kit';
import {
  BracketBoreArt,
  BracketChamferArt,
  BracketDrillArt,
  BracketLayoutArt,
  BracketTapArt,
  BracketWeldArt,
} from './bracket';
import {
  GearboxBearingArt,
  GearboxCheckArt,
  GearboxCoverArt,
  GearboxPartsArt,
  GearboxShaftArt,
  GearboxTorqueArt,
} from './gearbox';
import { DrawingSheet } from './drawings';

export type ArtComponent = (props: ArtProps) => ReactElement;

/** Единственное место, где id иллюстрации превращается в компонент. */
export const ART_REGISTRY: Readonly<Record<IllustrationId, ArtComponent>> = {
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
};

export function artFor(illustration: StepIllustration): ArtComponent {
  return isKnownIllustration(illustration.illustrationId)
    ? ART_REGISTRY[illustration.illustrationId]
    : GenericStepArt;
}

export { DrawingSheet };
