import { makePersisted } from '@solid-primitives/storage';
import { createSignal } from 'solid-js';
import { workspaceAccentNamed } from '../core/workspace-accent';

/** The workspace accent follows the user between the introductory slides. */
export function createWorkspaceAccent() {
  const [appearance, setAppearance] = makePersisted(
    createSignal({ color: 'Mint' }),
    { name: 'macro-workspace-intro-appearance' }
  );
  return {
    accent: () => workspaceAccentNamed(appearance().color),
    select: (name: string) => setAppearance({ color: name }),
  };
}
