import { useSettingsState } from '@core/constant/SettingsState';
import { isMobile } from '@core/mobile/isMobile';
import { settingsSlugToTab } from '@core/constant/settingsTabsConfig';
import { Navigate, useParams } from '@solidjs/router';
import { Layer } from '@ui';
import { createEffect, Show } from 'solid-js';
import { SettingsPanel } from './Settings';

/**
 * Settings as a full-page route (`/settings/:tab`). This replaces the old
 * signal-driven fullscreen overlay: the URL is now the source of truth for
 * whether settings is open and which page is showing, so it's linkable and
 * survives reload — without leaking the workspace layout that a query param on
 * the split path would have carried.
 *
 * The app sidebar is hidden on this route (see Layout's `sidebarVisible`), so
 * the panel fills the window. "Move to split" still docks settings into the
 * layout as a `settings/<tab>` split.
 *
 * Desktop-only: on mobile this route redirects into the docked-split form.
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

  // Mobile never shows the full-page route: its exit affordances ("Back to
  // app", "Move to split") all live in desktop-only chrome, so rendering it
  // would trap the user. Bounce into the docked-split form instead — the way
  // settings opens on mobile (see SettingsState.openSettings). Reached by deep
  // links, URLs persisted before mobile went back to split-docked settings,
  // and width changes (e.g. phone rotation) while on the route.
  const MobileSettingsRedirect = () => {
    // Carry the requested tab into the docked panel via the shared signal —
    // the docked form's URL (`component/settings`) doesn't encode it. Set
    // synchronously (not via the effect above) since navigation can unmount
    // this route before effects run.
    const initialTab = tab();
    if (initialTab) setActiveTabId(initialTab);
    return <Navigate href="/component/settings" />;
  };

  return (
    <Show when={!isMobile()} fallback={<MobileSettingsRedirect />}>
      <Show when={tab()} fallback={<Navigate href="/settings/account" />}>
        <div class="h-full w-full bg-surface">
          <Layer depth={0}>
            <SettingsPanel variant="fullscreen" />
          </Layer>
        </div>
      </Show>
    </Show>
  );
}
