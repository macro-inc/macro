import { t } from '@app/lib/i18n';
import { useKeyedPersistentToasts } from '@core/component/Toast/useKeyedPersistentToasts';
import { fireAndForget } from '@core/util/fireAndForget';
import { MacrodPairingApprover } from '@macro/tauri/MacrodPairingApprover';
import { macrodInspect, macrodSupport } from '@macro/tauri/macrod';
import { createSignal, onMount, Show } from 'solid-js';
import { LocalRuntimeSetup } from './local-runtime-setup';
import { LocalRuntimeSetupDialog } from './views/local-runtime-setup-dialog';

/** The single key of the first-run prompt; it has no per-item identity. */
const PROMPT_KEY = 'setup';

type Probe = { needsSetup: boolean; defaultWorkspace?: string };

/**
 * Everything the desktop app does for its bundled agent runtime outside
 * Settings: approve the daemon's pairings, and on a computer where it was
 * never set up, offer one-click setup once. Mount once, on desktop, inside
 * the authenticated shell.
 */
export function LocalRuntimeHost() {
  const [probe, setProbe] = createSignal<Probe>();
  const [dialogOpen, setDialogOpen] = createSignal(false);

  onMount(() => {
    fireAndForget(
      (async () => {
        const support = await macrodSupport();
        if (!support.supported) {
          setProbe({ needsSetup: false });
          return;
        }
        const inspection = await macrodInspect();
        setProbe({
          needsSetup: !inspection.exists,
          defaultWorkspace: support.defaultWorkspace ?? undefined,
        });
      })(),
      'local-runtime-host'
    );
  });

  useKeyedPersistentToasts({
    items: () => (probe()?.needsSetup ? [PROMPT_KEY] : []),
    key: (key) => key,
    // Advisory: Settings › Runtimes keeps setup reachable, so a close sticks.
    persistKey: 'macro:local-runtime-prompt:dismissed',
    itemsLoaded: () => probe() !== undefined,
    toast: (_key, dismiss) => ({
      title: t('localRuntime.promptTitle'),
      content(): string {
        return t('localRuntime.promptBody');
      },
      actions: [
        {
          label: t('localRuntime.setUp'),
          onClick: () => {
            dismiss();
            setDialogOpen(true);
          },
        },
      ],
    }),
  });

  return (
    <>
      <MacrodPairingApprover />
      <LocalRuntimeSetupDialog
        open={dialogOpen()}
        onClose={() => setDialogOpen(false)}
      >
        <Show when={dialogOpen()}>
          <LocalRuntimeSetup
            defaultWorkspace={probe()?.defaultWorkspace}
            autoStart
            onClose={() => setDialogOpen(false)}
          />
        </Show>
      </LocalRuntimeSetupDialog>
    </>
  );
}
