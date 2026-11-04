import type { Harness as RegisteredHarness } from '@service-storage/client';
import { For, Show } from 'solid-js';
import { ConnectAction, StatusDot } from '../integration-ui';
import { SettingsCard } from '../primitives';

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
                      {harness.owner.type === 'team' ? 'Team' : 'Private'}
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
                <div class="shrink-0">
                  <ConnectAction
                    label="Remove"
                    variant="danger"
                    onClick={() => props.onRemove(harness)}
                  />
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
