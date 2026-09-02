import { HeaderIsland } from '@components/app/split-layout/components/HeaderIsland';
import { SplitHeaderRight } from '@components/app/split-layout/components/SplitHeader';
import { blockSyncSourceSignal } from '@core/signal/load';
import { SyncSourceStatus } from '@macro-inc/collaboration/collab/source';
import CloudIcon from '@phosphor/cloud.svg';
import CloudWarningIcon from '@phosphor/cloud-warning.svg';
import { Button } from '@ui';
import { Match, Show, Switch } from 'solid-js';

export function CollabStatus() {
  const syncSource = blockSyncSourceSignal.get;

  const status = () => syncSource()?.status() ?? SyncSourceStatus.Disconnected;
  const showStatus = () =>
    status() === SyncSourceStatus.Disconnected ||
    status() === SyncSourceStatus.Connecting;

  return (
    <SplitHeaderRight>
      {/* `mode="outin"` so a state fully fades out before the next fades in
          (one toolbar slot). The <Switch> renders nothing when Connected,
          which the Transition treats as an exit (fade out). */}
      <Show when={showStatus()}>
        <HeaderIsland class="-order-1">
          <Switch>
            <Match when={status() === SyncSourceStatus.Disconnected}>
              <Button
                variant="outline"
                size="icon-sm"
                aria-label="Offline"
                tooltip="You're offline. Changes will sync when you reconnect."
                class="bg-alert-bg border-alert/20"
              >
                <CloudWarningIcon class="text-alert-ink" />
              </Button>
            </Match>
            <Match when={status() === SyncSourceStatus.Connecting}>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Reconnecting"
                tooltip="Reconnecting to the document…"
              >
                <CloudIcon class="text-ink-extra-muted animate-pulse" />
              </Button>
            </Match>
          </Switch>
        </HeaderIsland>
      </Show>
    </SplitHeaderRight>
  );
}
