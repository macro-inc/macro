import { SplitToolbarRight } from '@app/component/split-layout/components/SplitToolbar';
import { SyncSourceStatus } from '@core/collab/source';
import { blockSyncSourceSignal } from '@core/signal/load';
import CloudIcon from '@phosphor/cloud.svg';
import CloudWarningIcon from '@phosphor/cloud-warning.svg';
import { Button } from '@ui';
import { Match, Switch } from 'solid-js';

export function CollabStatus() {
  const syncSource = blockSyncSourceSignal.get;

  const status = () => syncSource()?.status() ?? SyncSourceStatus.Disconnected;

  return (
    <SplitToolbarRight>
      {/* `mode="outin"` so a state fully fades out before the next fades in
          (one toolbar slot). The <Switch> renders nothing when Connected,
          which the Transition treats as an exit (fade out). */}
      <Switch>
        <Match when={status() === SyncSourceStatus.Disconnected}>
          <div class="-order-1 flex items-center">
            <Button
              variant="base"
              size="icon-sm"
              aria-label="Offline"
              tooltip="You're offline. Changes will sync when you reconnect."
              class="bg-alert-bg border-alert/20"
            >
              <CloudWarningIcon class="text-alert-ink" />
            </Button>
          </div>
        </Match>
        <Match when={status() === SyncSourceStatus.Connecting}>
          <div class="-order-1 flex items-center">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Reconnecting"
              tooltip="Reconnecting to the document…"
            >
              <CloudIcon class="ink-text-extra-mutes animate-pulse" />
            </Button>
          </div>
        </Match>
      </Switch>
    </SplitToolbarRight>
  );
}
