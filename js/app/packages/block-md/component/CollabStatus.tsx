import { SyncSourceStatus } from '@core/collab/source';
import { blockSyncSourceSignal } from '@core/signal/load';
import ReconnectingIcon from '@phosphor/spinner.svg';
import DisconnectedIcon from '@phosphor/warning.svg';
import { Match, Switch } from 'solid-js';

export function CollabStatus() {
  const syncSource = blockSyncSourceSignal.get;

  const status = () => syncSource()?.status() ?? SyncSourceStatus.Disconnected;

  // SCUFFED STYLING: how do we want to handle these colors?
  return (
    <div class="flex flex-row items-center">
      <Switch>
        <Match when={status() === SyncSourceStatus.Disconnected}>
          <div class="flex flex-row space-x-1 text-xs text-[oklch(0.47_0.157_37.304)] px-2 py-1 items-center bg-[oklch(0.954_0.038_75.164)]">
            <DisconnectedIcon class="size-4 text-[oklch(0.75_0.183_55.934)]" />
            <p>
              You are currently disconnected. Check your connection and refresh
              the page.
            </p>
          </div>
        </Match>
        <Match when={status() === SyncSourceStatus.Connecting}>
          <div class="flex flex-row space-x-1 bg-[oklch(0.962_0.059_95.617)] text-xs text-[oklch(0.473_0.137_46.201)] px-2 py-1 items-center">
            <ReconnectingIcon class="size-4 text-[oklch(0.828_0.189_84.429)] animate-spin" />
            <p>Reconnecting to the document.</p>
          </div>
        </Match>
      </Switch>
    </div>
  );
}
