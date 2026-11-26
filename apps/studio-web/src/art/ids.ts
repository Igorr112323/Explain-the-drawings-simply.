export const ILLUSTRATION_IDS = [
  'bracket-layout',
  'bracket-drill',
  'bracket-tap',
  'bracket-bore',
  'bracket-chamfer',
  'bracket-weld',
  'gearbox-parts',
  'gearbox-bearing',
  'gearbox-shaft',
  'gearbox-cover',
  'gearbox-torque',
  'gearbox-check',
  'generic-step',
] as const;

export type IllustrationId = (typeof ILLUSTRATION_IDS)[number];

export function isKnownIllustration(id: string): id is IllustrationId {
  return (ILLUSTRATION_IDS as readonly string[]).includes(id);
}
