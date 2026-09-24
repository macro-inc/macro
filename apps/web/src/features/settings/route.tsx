import { defineRoute } from '@app/lib/split-router';
import {
  settingsSlugToTab,
  settingsTabToSlug,
} from '@core/constant/settingsTabsConfig';
import { lazy } from 'solid-js';
import { z } from 'zod';

export const SettingsRouteView = lazy(async () => ({
  default: (await import('./Settings')).SettingsPanelComponentWrapper,
}));

export const settingsRoute = defineRoute({
  id: 'settings',
  path: 'settings/:tab?',
  params: z.object({
    tab: z
      .string()
      .refine((tab) => settingsSlugToTab(tab) !== undefined)
      .default(settingsTabToSlug('Account')),
  }),
  component: SettingsRouteView,
  claim: () => ({ namespace: 'component', id: 'settings' }),
  externalSearch: ['pair', 'createAgent'],
});
