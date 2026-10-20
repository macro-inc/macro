import { useSettingsState } from '@core/constant/SettingsState';
import { useUserId } from '@core/context/user';
import { isDesktopPlatform } from '@core/util/platform';
import { createUserScopedStorage } from '@core/util/userScopedStorage';
import {
  macrodInspect,
  macrodStatus,
  macrodSupport,
  onMacrodStatus,
} from '@macro/tauri/macrod';
import LaptopIcon from '@phosphor/laptop.svg';
import XIcon from '@phosphor/x.svg';
import type { UnlistenFn } from '@tauri-apps/api/event';
import { createSignal, onCleanup, onMount, Show } from 'solid-js';

const dismissal = createUserScopedStorage(
  'macro:local-runtime-prompt:dismissed'
);
const dismissalEvent = 'macro:local-runtime-prompt:dismissed';

/** Invite each desktop installation to set up its own bundled local runtime. */
export function LocalRuntimePrompt() {
  if (!isDesktopPlatform()) return null;

  const userId = useUserId();
  const { openSettings } = useSettingsState();
  const [available, setAvailable] = createSignal(false);
  const [dismissalVersion, setDismissalVersion] = createSignal(0);

  const refreshDismissal = () => {
    setDismissalVersion((version) => version + 1);
  };
  const onStorage = (event: StorageEvent) => {
    if (event.key?.startsWith('macro:local-runtime-prompt:dismissed:')) {
      refreshDismissal();
    }
  };
  const dismissed = () => {
    dismissalVersion();
    const id = userId();
    return Boolean(id && dismissal.read(id) === '1');
  };

  onMount(() => {
    let disposed = false;
    let runningObserved = false;
    let unlisten: UnlistenFn | undefined;
    let refreshVersion = 0;
    window.addEventListener(dismissalEvent, refreshDismissal);
    window.addEventListener('storage', onStorage);

    const refresh = async () => {
      const version = ++refreshVersion;
      try {
        const [config, status] = await Promise.all([
          macrodInspect(),
          macrodStatus(),
        ]);
        if (!disposed && !runningObserved && version === refreshVersion) {
          setAvailable(!config.paired && status.phase !== 'running');
        }
      } catch (error) {
        console.error('could not inspect the local agent runtime', error);
      }
    };

    const inspect = async () => {
      try {
        const support = await macrodSupport();
        if (!support.supported || disposed) return;
        void refresh();
        void (async () => {
          try {
            const stop = await onMacrodStatus((status) => {
              if (status.phase === 'running') {
                runningObserved = true;
                setAvailable(false);
              }
            });
            if (disposed) {
              stop();
              return;
            }
            unlisten = stop;
            await refresh();
          } catch (error) {
            console.error('could not watch the local agent runtime', error);
          }
        })();
      } catch (error) {
        console.error('could not check local agent support', error);
      }
    };
    void inspect();

    onCleanup(() => {
      disposed = true;
      unlisten?.();
      window.removeEventListener(dismissalEvent, refreshDismissal);
      window.removeEventListener('storage', onStorage);
    });
  });

  const dismiss = () => {
    const id = userId();
    if (id) dismissal.write(id, '1');
    window.dispatchEvent(new Event(dismissalEvent));
  };

  return (
    <Show when={available() && !dismissed()}>
      <div class="mb-3 flex items-center gap-1 rounded-xl border border-edge-muted bg-surface p-1.5 text-ink">
        <button
          type="button"
          class="flex min-w-0 flex-1 items-center gap-3 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          onClick={() => openSettings('Harness')}
        >
          <LaptopIcon class="size-5 shrink-0 text-accent" aria-hidden="true" />
          <span class="min-w-0 flex-1">
            <span class="block text-sm font-medium">
              Run agents on this computer
            </span>
            <span class="block text-xs text-ink-muted">
              Use your installed agents and local files in Macro.
            </span>
          </span>
          <span class="shrink-0 text-xs font-medium text-accent">Set up</span>
        </button>
        <button
          type="button"
          class="flex size-8 shrink-0 items-center justify-center rounded-lg text-ink-muted hover:bg-hover hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          aria-label="Dismiss Run agents on this computer"
          onClick={dismiss}
        >
          <XIcon class="size-4" aria-hidden="true" />
        </button>
      </div>
    </Show>
  );
}
