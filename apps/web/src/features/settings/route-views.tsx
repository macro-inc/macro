import { lazy } from 'solid-js';

export const SettingsRouteView = lazy(async () => ({
  default: (await import('./Settings')).SettingsPanelComponentWrapper,
}));
