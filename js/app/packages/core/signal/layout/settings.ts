import { createCallback } from '@solid-primitives/rootless';
import { createSignal } from 'solid-js';

// Simple boolean signal for settings panel open state
// Default to closed (false)
export const [isSettingsPanelOpen, setIsSettingsPanelOpen] = createSignal(false);

// Toggle function for settings panel
export function useToggleSettingsPanel() {
  return createCallback((next?: boolean) => {
    setIsSettingsPanelOpen((prev) => {
      if (next !== undefined) return next;
      return !prev;
    });
  });
}