import { makePersisted } from '@solid-primitives/storage';
import { createSignal } from 'solid-js';

export const WORKSPACE_ACCENTS = [
  { name: 'Pearl', color: '#e8e2db' },
  { name: 'Lilac', color: '#b8a1ed' },
  { name: 'Coral', color: '#f77d67' },
  { name: 'Amber', color: '#f4c65c' },
  { name: 'Mint', color: '#65d8ac' },
  { name: 'Sky', color: '#7abde5' },
];

/** The workspace accent follows the user between the introductory slides. */
export function createWorkspaceAccent() {
  const [appearance, setAppearance] = makePersisted(
    createSignal({ color: 'Mint' }),
    { name: 'macro-workspace-intro-appearance' }
  );
  return {
    accent: () =>
      WORKSPACE_ACCENTS.find((item) => item.name === appearance().color) ??
      WORKSPACE_ACCENTS[4],
    select: (color: string) => setAppearance({ color }),
  };
}
