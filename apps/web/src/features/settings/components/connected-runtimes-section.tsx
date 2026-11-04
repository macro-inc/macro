import { useShareRequests } from '@app/features/access-requests/access-requests';
import { shareEntity } from '@app/features/access-requests/core/types';
import { t } from '@app/lib/i18n';
import type { Harness as RegisteredHarness } from '@service-storage/client';
import { Button } from '@ui';
import { createSignal, For, lazy, Show, Suspense } from 'solid-js';
import { ConnectAction, StatusDot } from '../integration-ui';
import { SettingsCard } from '../primitives';

const RuntimeShareDialog = lazy(async () => ({
  default: (
    await import('@app/features/runtime-sharing/views/RuntimeShareDialog')
  ).RuntimeShareDialog,
}));

/** The owner's Share button, with the menu it opens and requests waiting in it. */
function ShareRuntime(props: { harness: RegisteredHarness }) {
  const [open, setOpen] = createSignal(false);
  const requests = useShareRequests(
    () => shareEntity('harness', props.harness.id),
    () => true
  );
  const pending = () => requests.state()?.pendingCount ?? 0;
  return (
    <>
      <Button
        variant="secondary"
        size="sm"
        aria-label={
          pending() > 0
            ? t('runtimeSharing.shareRequests', { count: pending() })
            : undefined
        }
        onClick={() => setOpen(true)}
      >
        {t('runtimeSharing.share')}
        <Show when={pending() > 0}>
          <span class="text-xs text-accent-ink">{pending()}</span>
        </Show>
      </Button>
      <Show when={open()}>
        <Suspense>
          <RuntimeShareDialog
            harness={props.harness}
            open={open()}
            onOpenChange={setOpen}
          />
        </Suspense>
      </Show>
    </>
  );
}

function lastConnectedText(harness: RegisteredHarness): string {
  return harness.last_connected_at
    ? `Last connected ${new Date(harness.last_connected_at).toLocaleString()}`
    : 'Never connected';
}

/**
 * The machines paired to this account, connected ones first.
 *
 * Nothing is shown until at least one runtime is connected: with none, the
 * setup cards above are the only useful thing on the page, and a list of
 * machines that cannot run anything reads as a fault. Disconnected runtimes
 * stay listed once any sibling is connected, because removing a stale pairing
 * is the reason to come here.
 */
export function ConnectedRuntimesSection(props: {
  harnesses: readonly RegisteredHarness[];
  /** The runtimes could not be loaded; say so rather than show an empty page. */
  error: boolean;
  onRemove: (harness: RegisteredHarness) => void;
  /** A team's owner can also take a machine the team runs on out of service. */
  canRemoveShared: boolean;
}) {
  const connectedCount = () =>
    props.harnesses.filter((harness) => harness.connected).length;
  const ordered = () => [
    ...props.harnesses.filter((harness) => harness.connected),
    ...props.harnesses.filter((harness) => !harness.connected),
  ];

  return (
    <Show when={connectedCount() > 0 || props.error}>
      <div>
        <Show when={connectedCount() > 0}>
          <h2 class="mb-3 px-6 text-sm font-semibold text-ink">
            Connected runtimes
          </h2>
        </Show>
        <SettingsCard>
          <For each={ordered()}>
            {(harness) => (
              <div class="flex items-center justify-between gap-4 px-4 py-3">
                <div class="min-w-0 flex-1">
                  <div class="flex min-w-0 items-center gap-2">
                    <p class="min-w-0 flex-1 truncate text-sm text-ink">
                      {harness.name}
                    </p>
                    <span class="inline-flex h-5 shrink-0 items-center whitespace-nowrap rounded-md border border-edge-muted px-2 text-xxs/none font-medium uppercase text-ink-extra-muted">
                      {harness.shared_team_ids.length > 0 ? 'Team' : 'Private'}
                    </span>
                    <StatusDot
                      state={harness.connected ? 'connected' : 'disconnected'}
                      label={harness.connected ? 'Connected' : 'Offline'}
                    />
                  </div>
                  <p class="mt-0.5 truncate text-xs text-ink-extra-muted">
                    {lastConnectedText(harness)}
                  </p>
                </div>
                <div class="flex shrink-0 items-center gap-2">
                  <Show when={harness.access === 'owner'}>
                    <ShareRuntime harness={harness} />
                  </Show>
                  <Show
                    when={
                      harness.access === 'owner' ||
                      (props.canRemoveShared &&
                        harness.shared_team_ids.length > 0)
                    }
                  >
                    <ConnectAction
                      label="Remove"
                      variant="danger"
                      onClick={() => props.onRemove(harness)}
                    />
                  </Show>
                </div>
              </div>
            )}
          </For>
          <Show when={props.error}>
            <p class="px-4 py-3 text-xs text-negative">
              Could not load your runtimes. Try refreshing this page.
            </p>
          </Show>
        </SettingsCard>
      </div>
    </Show>
  );
}
