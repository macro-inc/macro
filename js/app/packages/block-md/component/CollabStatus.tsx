import { SyncSourceStatus } from '@core/collab/source';
import { blockSyncSourceSignal } from '@core/signal/load';
import ReconnectingIcon from '@icon/regular/spinner.svg';
import DisconnectedIcon from '@icon/regular/warning.svg';
import { Match, Switch } from 'solid-js';

export function CollabStatus() {
  const syncSource = blockSyncSourceSignal.get;

  const status = () => syncSource()?.status() ?? SyncSourceStatus.Disconnected;

  // SCUFFED STYLING: how do we want to handle these colors?
  return (
    <div class="flex flex-row items-center">
      <Switch>
        <Match when={status() === SyncSourceStatus.Disconnected}>
          <div class="flex flex-row space-x-1 text-xs text-orange-800 px-2 py-1 items-center bg-orange-100">
            <DisconnectedIcon class="size-4 text-orange-400" />
            <p>
              You are currently disconnected. Check your connection and refresh
              the page.
            </p>
          </div>
        </Match>
        <Match when={status() === SyncSourceStatus.Connecting}>
          <div class="flex flex-row space-x-1 bg-amber-100 text-xs text-amber-800 px-2 py-1 items-center">
            <ReconnectingIcon class="size-4 text-amber-400 animate-spin" />
            <p>Reconnecting to the document.</p>
          </div>
        </Match>
      </Switch>
    </div>
  );
}
