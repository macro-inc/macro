/**
 * TEMPORARY: debug controls for previewing the rail's update button. Visit any
 * app URL with `?debug-updates` to show the panel; close it from the panel.
 * Remove this file and its two call sites (useAppUpdate, AppChrome) once the
 * update visuals are settled.
 */
import { toast } from '@core/component/Toast/Toast';
import { createSignal, For, Show } from 'solid-js';
import { type AppUpdate, UPDATE_COPY } from './app-update';

const ENABLED_KEY = 'macro:debug-updates';
const DISMISSED_KEY = 'macro:app-update-dismissed';

type Simulated = 'none' | 'web' | 'bundle' | 'native' | 'native-busy';

const OPTIONS: { value: Simulated; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'web', label: 'Web build' },
  { value: 'bundle', label: 'Desktop bundle' },
  { value: 'native', label: 'Desktop app' },
  { value: 'native-busy', label: 'Desktop app, preparing' },
];

function readEnabled(): boolean {
  try {
    if (new URLSearchParams(window.location.search).has('debug-updates')) {
      localStorage.setItem(ENABLED_KEY, '1');
    }
    return localStorage.getItem(ENABLED_KEY) === '1';
  } catch {
    return false;
  }
}

const [enabled, setEnabled] = createSignal(readEnabled());
const [simulated, setSimulated] = createSignal<Simulated>('none');
const [generation, setGeneration] = createSignal(1);

const pretend = (action: string) => () =>
  toast.success(`Debug: would ${action}`);

/** The simulated update, which wins over real ones while the panel is open. */
export function debugAppUpdate(): AppUpdate | undefined {
  if (!enabled()) return;
  const id = `debug:${simulated()}:${generation()}`;
  switch (simulated()) {
    case 'none':
      return;
    case 'web':
      return { id, ...UPDATE_COPY.web, busy: false, apply: pretend('reload') };
    case 'bundle':
      return {
        id,
        ...UPDATE_COPY.bundle,
        busy: false,
        apply: pretend('apply the bundle update'),
      };
    case 'native':
    case 'native-busy': {
      const busy = simulated() === 'native-busy';
      return {
        id: `debug:native:${generation()}`,
        ...(busy ? UPDATE_COPY.nativePreparing : UPDATE_COPY.native),
        busy,
        apply: pretend('restart'),
      };
    }
  }
}

/** Floating panel to pick a simulated update and replay the first-open popover. */
export function AppUpdateDebugPanel() {
  const resetDismissal = () => {
    try {
      localStorage.removeItem(DISMISSED_KEY);
    } catch {}
  };

  const close = () => {
    try {
      localStorage.removeItem(ENABLED_KEY);
    } catch {}
    setSimulated('none');
    setEnabled(false);
  };

  return (
    <Show when={enabled()}>
      <div class="fixed right-4 bottom-4 z-float w-60 rounded-xl border border-edge-muted bg-menu p-3 text-ink text-xs shadow-xl">
        <div class="mb-2 flex items-center justify-between">
          <span class="font-semibold">Update debug (temporary)</span>
          <button
            type="button"
            class="rounded px-1.5 py-0.5 text-ink-muted hover:bg-hover"
            onClick={close}
          >
            Close
          </button>
        </div>
        <div class="flex flex-col gap-1">
          <For each={OPTIONS}>
            {(option) => (
              <label class="flex items-center gap-2">
                <input
                  type="radio"
                  name="debug-update"
                  checked={simulated() === option.value}
                  onChange={() => setSimulated(option.value)}
                />
                {option.label}
              </label>
            )}
          </For>
        </div>
        <div class="mt-3 flex flex-wrap gap-1.5">
          <button
            type="button"
            class="rounded-md border border-edge-muted px-2 py-1 hover:bg-hover"
            onClick={() => setGeneration((value) => value + 1)}
          >
            New update id
          </button>
          <button
            type="button"
            class="rounded-md border border-edge-muted px-2 py-1 hover:bg-hover"
            onClick={() => {
              resetDismissal();
              setGeneration((value) => value + 1);
            }}
          >
            Reset dismissal
          </button>
        </div>
      </div>
    </Show>
  );
}
