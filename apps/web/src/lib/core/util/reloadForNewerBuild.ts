import { toast } from '@core/component/Toast/Toast';
import { deviceLooksOffline } from './connectivity';

/** What the reload decision needs from the page; replaced in tests. */
export interface ReloadPage {
  isHidden(): boolean;
  isOffline(): boolean;
  reload(): void;
  /** Runs `callback` once, the next time the page is hidden. */
  onceHidden(callback: () => void): void;
  /** Runs `callback` once, when the device next reports being online. */
  onceOnline(callback: () => void): void;
  /** Offers the user a reload now; `reload` follows the same rules. */
  promptReload(reload: () => void): void;
}

const browserPage: ReloadPage = {
  isHidden: () => document.visibilityState === 'hidden',
  isOffline: deviceLooksOffline,
  reload: () => window.location.reload(),
  onceHidden(callback) {
    const onChange = () => {
      if (document.visibilityState !== 'hidden') return;
      document.removeEventListener('visibilitychange', onChange);
      callback();
    };
    document.addEventListener('visibilitychange', onChange);
  },
  onceOnline(callback) {
    window.addEventListener('online', callback, { once: true });
  },
  promptReload(reload) {
    toast.success('A new version of Macro is ready', {
      subtext: 'This tab reloads when you switch away from it.',
      duration: 30_000,
      actions: [{ label: 'Reload now', onClick: reload }],
    });
  },
};

let scheduled = false;

/**
 * A newer build of the app took over this tab's local cache, so the tab moves
 * to that build. A hidden tab reloads right away. The visible tab offers a
 * reload and otherwise reloads when the user switches away, so nothing they
 * are typing is lost. No reload happens while offline, where the page could
 * not load again.
 */
export function reloadForNewerBuild(page: ReloadPage = browserPage): void {
  if (scheduled) return;
  scheduled = true;
  let reloaded = false;
  const reload = () => {
    if (reloaded) return;
    if (page.isOffline()) {
      page.onceOnline(reload);
      return;
    }
    reloaded = true;
    page.reload();
  };
  if (page.isHidden()) {
    reload();
    return;
  }
  page.onceHidden(reload);
  page.promptReload(reload);
}

/** Test seam: forget that a reload was scheduled. */
export function resetReloadForNewerBuildForTests(): void {
  scheduled = false;
}
