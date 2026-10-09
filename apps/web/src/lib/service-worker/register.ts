import { ROUTER_BASE_CONCAT } from '@app/constants/routerBase';
import { isTauri } from '@core/util/platform';
import { reloadForNewerBuild } from '@core/util/reloadForNewerBuild';

/**
 * Set localStorage `macro:sw` to `off` to unregister the worker. Its caches
 * are cleared on the first load it no longer controls.
 */
const OPT_OUT_KEY = 'macro:sw';
/** How long after load an untouched tab may silently reload into a newer build. */
const SILENT_RELOAD_WINDOW_MS = 10_000;

let newerBuildAvailable = false;
let interacted = false;

/** The bundle build this page booted, from index.html. */
function runningBuild(): number {
  const content = document
    .querySelector<HTMLMetaElement>('meta[name="macro-bundle-build"]')
    ?.getAttribute('content');
  return Number(content);
}

function optedOut(): boolean {
  try {
    return localStorage.getItem(OPT_OUT_KEY) === 'off';
  } catch {
    return false;
  }
}

async function unregister(): Promise<void> {
  const registrations = await navigator.serviceWorker.getRegistrations();
  await Promise.all(
    registrations.map((registration) => registration.unregister())
  );
  const names = await caches.keys();
  await Promise.all(
    names
      .filter((name) => name.startsWith('macro-'))
      .map((name) => caches.delete(name))
  );
}

/**
 * The worker cached a newer build than this tab runs: a tab that booted the
 * cached shell right after a deploy. Untouched tabs reload straight away (the
 * boot shell shows again); otherwise the regular newer-build flow decides.
 */
function onWorkerMessage(event: MessageEvent<unknown>): void {
  const data = event.data as { type?: unknown; build?: unknown } | null;
  if (data?.type !== 'macro:newer-build') return;
  const running = runningBuild();
  if (!Number.isFinite(running) || Number(data.build) <= running) return;
  newerBuildAvailable = true;
  if (!interacted && performance.now() < SILENT_RELOAD_WINDOW_MS) {
    window.location.reload();
    return;
  }
  reloadForNewerBuild();
}

/**
 * Whether a failed lazy chunk is explained by a newer deployed build, so the
 * tab should reload into it instead of reporting an error.
 */
export function isNewerBuildAvailable(): boolean {
  return newerBuildAvailable;
}

/**
 * Registers public/sw.js, which serves the app shell and hashed assets from
 * Cache Storage so new tabs skip the HTML round trip. Production web only:
 * Tauri ships its own bundle and dev servers rebuild assets in place.
 */
export function registerServiceWorker(): void {
  if (!import.meta.env.PROD || isTauri()) return;
  if (!('serviceWorker' in navigator) || !window.isSecureContext) return;
  if (!window.location.pathname.startsWith(ROUTER_BASE_CONCAT.slice(0, -1))) {
    return;
  }
  if (optedOut()) {
    void unregister().catch(() => {});
    return;
  }

  for (const type of ['pointerdown', 'keydown'] as const) {
    window.addEventListener(type, () => (interacted = true), {
      capture: true,
      once: true,
    });
  }
  navigator.serviceWorker.addEventListener('message', onWorkerMessage);

  // Registration installs the worker, which fetches the shell and entry
  // assets; keep that off the critical path of this load.
  const register = () =>
    navigator.serviceWorker
      .register(`${ROUTER_BASE_CONCAT}sw.js`, { scope: ROUTER_BASE_CONCAT })
      .catch((error: unknown) =>
        console.warn('Service worker registration failed', error)
      );
  const whenIdle = () =>
    'requestIdleCallback' in window
      ? window.requestIdleCallback(register, { timeout: 5000 })
      : setTimeout(register, 1000);
  if (document.readyState === 'complete') whenIdle();
  else window.addEventListener('load', whenIdle, { once: true });
}
