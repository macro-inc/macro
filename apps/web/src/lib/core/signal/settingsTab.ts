import type { SettingsTab } from '@core/constant/SettingsState';
import { createSignal } from 'solid-js';

/**
 * The active settings page. Lives in its own leaf module (rather than in
 * SettingsState) so the split-layout URL serializer can read it to encode a
 * docked settings split as `settings/<tab>` without creating an import cycle:
 * SettingsState → split-layout → layoutManager → activeTabId.
 *
 * The `SettingsTab` import above is type-only, so it's erased at runtime and
 * doesn't reintroduce the cycle.
 */
export const [activeTabId, setActiveTabId] =
  createSignal<SettingsTab>('Account');
