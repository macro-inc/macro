import { authServiceClient } from '@service-auth/client';
import { logger } from '@observability';
import { createEffect, on } from 'solid-js';
import {
  darkModeTheme,
  lightModeTheme,
  setDarkModeTheme,
  setLightModeTheme,
  setThemeShouldMatchSystem,
  themeShouldMatchSystem,
} from '../../theme/signals/themeSignals';

// The per-mode theme preferences live in localStorage for instant first paint,
// but the backend is the source of truth: on login we hydrate from it (backend
// wins), then write through every change. This snapshot guards against the
// hydration writes echoing straight back as a redundant PATCH.
let lastSyncedSnapshot: string | null = null;

const snapshot = (light: string, dark: string, matchesSystem: boolean) =>
  JSON.stringify({ light, dark, matchesSystem });

/** Sets up write-through syncing: PATCHes the backend whenever a per-mode theme
 *  preference changes. Call once from a stable reactive owner (a component body,
 *  not inside another effect, so the inner effect isn't disposed on re-run). */
export function setupThemePreferenceSync(): void {
  // Deferred so the current values at setup don't trigger a write; the snapshot
  // guard suppresses the write that hydration itself would otherwise cause.
  createEffect(
    on(
      [lightModeTheme, darkModeTheme, themeShouldMatchSystem],
      ([light, dark, matchesSystem]) => {
        const next = snapshot(light, dark, matchesSystem);
        if (next === lastSyncedSnapshot) return;
        lastSyncedSnapshot = next;
        void authServiceClient
          .patchThemePreferences({
            preferredLightTheme: light,
            preferredDarkTheme: dark,
            themeMatchesSystem: matchesSystem,
          })
          .then((result) => {
            if (result.isErr()) {
              logger.error('Failed to sync theme preferences to backend');
            }
          });
      },
      { defer: true }
    )
  );
}

/** Pulls per-mode theme preferences from the backend (backend wins on login) and
 *  applies them to the local signals. Safe to call from within an effect — it's a
 *  plain async fn, not a reactive computation. */
export async function hydrateThemePreferencesFromBackend(): Promise<void> {
  const result = await authServiceClient.getThemePreferences();
  if (result.isErr()) return;
  const prefs = result.value;
  // Record the snapshot before applying so the write-through effect treats the
  // hydrated values as already-synced.
  lastSyncedSnapshot = snapshot(
    prefs.preferredLightTheme,
    prefs.preferredDarkTheme,
    prefs.themeMatchesSystem
  );
  setLightModeTheme(prefs.preferredLightTheme);
  setDarkModeTheme(prefs.preferredDarkTheme);
  setThemeShouldMatchSystem(prefs.themeMatchesSystem);
}
