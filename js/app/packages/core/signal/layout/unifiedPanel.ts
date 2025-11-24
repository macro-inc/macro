import { createCallback } from '@solid-primitives/rootless';
import { createSignal } from 'solid-js';

export type PanelType = 'rightbar' | 'settings' | null;

// Single signal to track which panel is open
export const [openPanel, setOpenPanel] = createSignal<PanelType>(null);

// Helper getters for backward compatibility
export const isRightPanelOpen = () => openPanel() === 'rightbar';
export const isSettingsPanelOpen = () => openPanel() === 'settings';

// Toggle functions for each panel
export function useToggleRightPanel() {
  return createCallback((next?: boolean) => {
    if (next === false) {
      // Explicitly closing
      if (openPanel() === 'rightbar') {
        setOpenPanel(null);
      }
    } else if (next === true) {
      // Explicitly opening
      setOpenPanel('rightbar');
    } else {
      // Toggle
      setOpenPanel(openPanel() === 'rightbar' ? null : 'rightbar');
    }
  });
}

export function useToggleSettingsPanel() {
  return createCallback((next?: boolean) => {
    if (next === false) {
      // Explicitly closing
      if (openPanel() === 'settings') {
        setOpenPanel(null);
      }
    } else if (next === true) {
      // Explicitly opening
      setOpenPanel('settings');
    } else {
      // Toggle
      setOpenPanel(openPanel() === 'settings' ? null : 'settings');
    }
  });
}

// Generic toggle for any panel
export function useTogglePanel() {
  return createCallback((panel: PanelType) => {
    setOpenPanel(openPanel() === panel ? null : panel);
  });
}

// Close any open panel
export function closeAllPanels() {
  setOpenPanel(null);
}