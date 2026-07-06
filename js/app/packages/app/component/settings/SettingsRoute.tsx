import { settingsSlugToTab } from '@core/constant/settingsTabsConfig';
import { useSettingsState } from '@core/constant/SettingsState';
import { Navigate, useParams } from '@solidjs/router';
import { Layer } from '@ui';
import { createEffect, Show } from 'solid-js';
import { SettingsPanel } from './Settings';

/**
 * Settings as a full-page route (`/settings/:tab`). This replaces the old
 * signal-driven fullscreen modal: the URL is now the source of truth for
 * whether settings is open and which page is showing, so it's linkable and
 * survives reload — without leaking the workspace layout that a query param on
 * the split path would have carried.
 *
 * The app sidebar is hidden on this route (see Layout's `sidebarVisible`), so
 * the panel fills the window exactly as the modal did. "Move to split" still
 * docks settings into the layout as a `component/settings` split.
 */
export function SettingsRoute() {
  const params = useParams<{ tab?: string }>();
  const { setActiveTabId } = useSettingsState();

  const tab = () => settingsSlugToTab(params.tab);

  // Route → state: keep the shared panel's active tab in sync with the URL.
  // Known-but-unavailable tabs (gated behind a flag/permission) still set the
  // tab; the panel renders it blank until the gate resolves, which preserves
  // deep links rather than bouncing legitimate users off mid-load.
  createEffect(() => {
    const current = tab();
    if (current) setActiveTabId(current);
  });

  return (
    <Show when={tab()} fallback={<Navigate href="/settings/account" />}>
      <div class="h-full w-full bg-surface">
        <Layer depth={0}>
          <SettingsPanel variant="modal" />
        </Layer>
      </div>
    </Show>
  );
}
