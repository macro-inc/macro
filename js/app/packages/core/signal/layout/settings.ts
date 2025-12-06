import { createCallback } from '@solid-primitives/rootless';
import { createSignal } from 'solid-js';

const DEFAULT_SETTINGS_PANEL_SIZE = 600;

export const [storedSettingsPanelSize, setStoredSettingsPanelSize] =
  createSignal(DEFAULT_SETTINGS_PANEL_SIZE);

// Simple boolean signal for settings panel collapsed state
// Default to collapsed (true)
export const [isSettingsPanelOpen, setIsSettingsPanelOpen] =
  createSignal(false);

// Settings panel size for resize
export const [persistedSettingsSizes, setPersistedSettingsSizes] = createSignal<
  [number, number]
>([1, 0]);

export function useToggleSettingsPanel() {
  return createCallback((next?: boolean) => {
    setIsSettingsPanelOpen((prev) => {
      if (next !== undefined) return next;
      return !prev;
    });
  });
}
