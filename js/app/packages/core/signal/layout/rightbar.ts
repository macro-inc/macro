import { createCallback } from '@solid-primitives/rootless';
import { createSignal } from 'solid-js';
import { setIsSettingsPanelOpen } from './settings';

const DEFAULT_RIGHT_PANEL_SIZE = 600;

export const [storedRightPanelSize, setStoredRightPanelSize] = createSignal(
  DEFAULT_RIGHT_PANEL_SIZE
);

// Simple boolean signal for right panel collapsed state
// Default to collapsed (true)
export const [isRightPanelOpen, setIsRightPanelOpen] = createSignal(false);

// default to closed right bar
// NOTE: this is no longer persisted to local storage
export const [persistedLayoutSizes, setPersistedLayoutSizes] = createSignal<
  [number, number]
>([1, 0]);

export function useToggleRightPanel() {
  return createCallback((next?: boolean) => {
    setIsRightPanelOpen((prev) => {
      const newState = next !== undefined ? next : !prev;
      if(newState){setIsSettingsPanelOpen(false)}
      return newState;
    });
  });
}
