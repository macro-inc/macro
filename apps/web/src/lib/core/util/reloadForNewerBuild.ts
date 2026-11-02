import type { ReloadReason } from '@app/observability/generated/native-diagnostics';
import { reloadApp } from '@app/observability/reload';
import { toast } from '@core/component/Toast/Toast';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { createSignal } from 'solid-js';
import { deviceLooksOffline } from './connectivity';
import { isEditableInput } from './isEditableInput';

/** What the reload decision needs from the page; replaced in tests. */
export interface ReloadPage {
  isHidden(): boolean;
  isOffline(): boolean;
  /** Whether focus is in a text field that holds text a reload would lose. */
  isEditingText(): boolean;
  reload(reason: ReloadReason): void;
  /** Runs `callback` each time the page is hidden or comes back online. */
  onHiddenOrOnline(callback: () => void): void;
  /** Offers the user a reload now; `build` is the newer build, when known. */
  promptReload(reload: () => void, build?: string): void;
}

/** A newer web build this tab can reload into. */
export type PendingWebUpdate = {
  build?: string;
  reload: () => void;
  /** How many of this build's lazy chunks failed to load since it was found. */
  failedLoads?: number;
};

const [pendingWebUpdate, setPendingWebUpdate] =
  createSignal<PendingWebUpdate>();

/** The newer web build waiting for a reload, which the rail's update button offers. */
export { pendingWebUpdate };

const browserPage: ReloadPage = {
  isHidden: () => document.visibilityState === 'hidden',
  isOffline: deviceLooksOffline,
  isEditingText() {
    const focused = document.activeElement;
    if (!isEditableInput(focused)) return false;
    const text =
      focused instanceof HTMLInputElement ||
      focused instanceof HTMLTextAreaElement
        ? focused.value
        : focused?.textContent;
    return Boolean(text?.trim());
  },
  reload: reloadApp,
  onHiddenOrOnline(callback) {
    // Run a task later: a page being unloaded also turns hidden, and its
    // timers never run, so leaving the app never becomes a reload.
    const later = () => setTimeout(callback, 0);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') later();
    });
    window.addEventListener('online', later);
  },
  promptReload(reload, build) {
    setPendingWebUpdate({ build, reload });
    // Touch layouts have no rail to show the update button in.
    if (!isTouchDevice()) return;
    toast.custom(
      {
        title: 'A new version of Macro is ready',
        actions: [{ label: 'Reload', onClick: reload }],
      },
      { persistent: true }
    );
  },
};

const holds = new Set<symbol>();
let scheduled = false;

/** Checks active calls/uploads/imports without executing unload side effects. */
export function hasAutomaticReloadHolds(): boolean {
  return holds.size > 0;
}

/**
 * Keeps this tab from reloading by itself into a newer build while work a
 * reload would cut off is running, such as a call or an upload. Returns the
 * release. The user can still reload from the prompt.
 */
export function holdAutomaticReload(): () => void {
  const hold = Symbol('automatic reload hold');
  holds.add(hold);
  return () => {
    holds.delete(hold);
  };
}

/**
 * A newer build of the app took over this tab's local cache, so the tab keeps
 * working without it and should move to that build. It offers a reload, and
 * reloads by itself only while it is in the background and the reload loses
 * nothing: the device is online, nothing holds the tab, and no text is being
 * written. Otherwise it tries again the next time it is hidden or comes back
 * online.
 */
export function reloadForNewerBuild(
  page: ReloadPage = browserPage,
  build?: string
): void {
  if (scheduled) return;
  scheduled = true;
  const reloadIfIdle = () => {
    if (
      page.isHidden() &&
      !page.isOffline() &&
      holds.size === 0 &&
      !page.isEditingText()
    ) {
      page.reload('cache_replaced_automatic');
    }
  };
  page.onHiddenOrOnline(reloadIfIdle);
  page.promptReload(() => page.reload('update_accepted'), build);
  reloadIfIdle();
}

/**
 * A lazy chunk of this build failed to load, which after a deploy means a newer
 * build replaced it. Offers the reload the same way as a newer build, and opens
 * the offer again even if it was dismissed, since something the user opened
 * just failed.
 */
export function promptReloadForFailedLoad(
  page: ReloadPage = browserPage
): void {
  reloadForNewerBuild(page);
  const current = pendingWebUpdate();
  setPendingWebUpdate({
    reload: () => reloadApp('failed_load_recovery'),
    build: current?.build,
    failedLoads: (current?.failedLoads ?? 0) + 1,
  });
}

/** Allows one automatic reload per build; replaced in tests. */
export interface ReloadOnce {
  /** Records a reload of `build`; false when it already reloaded this session
   * or the reload cannot be recorded, so a reload can never loop. */
  claim(build: string): boolean;
}

const FAILED_LOAD_RELOAD_KEY = 'macro:failed-load-reload';

/** Records every build this tab session reloaded for, so two stale builds
 * served in turn cannot reload each other in a loop. */
const sessionReloadOnce: ReloadOnce = {
  claim(build) {
    try {
      const saved: unknown = JSON.parse(
        sessionStorage.getItem(FAILED_LOAD_RELOAD_KEY) ?? '[]'
      );
      const builds = Array.isArray(saved) ? saved : [];
      if (builds.includes(build)) return false;
      sessionStorage.setItem(
        FAILED_LOAD_RELOAD_KEY,
        JSON.stringify([...builds, build])
      );
      return true;
    } catch {
      return false;
    }
  },
};

const currentBuild = `${import.meta.env.__APP_VERSION__ ?? 'dev'}@${
  import.meta.env.__APP_BUILD_TIME__ ?? 0
}`;

/**
 * A lazy chunk or its CSS failed to load, usually because a deploy removed this
 * build's files. Reloads into the deployed build right away when the reload
 * loses nothing: the device is online, nothing holds the tab, and no text is
 * being written. Otherwise it offers the reload, which reloads a hidden tab by
 * itself. Either automatic reload happens once per build per tab session, so a
 * stale cache serving this build again cannot loop.
 */
export function recoverFromFailedLoad(
  page: ReloadPage = browserPage,
  reloadOnce: ReloadOnce = sessionReloadOnce,
  build: string = currentBuild
): void {
  if (
    !page.isOffline() &&
    holds.size === 0 &&
    !page.isEditingText() &&
    reloadOnce.claim(build)
  ) {
    page.reload('failed_load_recovery');
    return;
  }
  promptReloadForFailedLoad({
    ...page,
    reload(reason) {
      if (reason !== 'cache_replaced_automatic' || reloadOnce.claim(build)) {
        page.reload(reason);
      }
    },
  });
}

/** Test seam: forget the scheduled reload and every hold. */
export function resetReloadForNewerBuildForTests(): void {
  scheduled = false;
  holds.clear();
}
