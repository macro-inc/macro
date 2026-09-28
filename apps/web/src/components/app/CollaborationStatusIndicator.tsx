import { SyncSourceStatus } from '@macro-inc/collaboration/collab/source';
import CloudIcon from '@phosphor/cloud.svg';
import CloudWarningIcon from '@phosphor/cloud-warning.svg';
import { Tooltip } from '@ui';
import { Match, Switch } from 'solid-js';

export function isCollaborationStatusVisible(
  status: SyncSourceStatus | undefined
): boolean {
  return (
    status === SyncSourceStatus.Disconnected ||
    status === SyncSourceStatus.Connecting
  );
}

export function CollaborationStatusIndicator(props: {
  status: SyncSourceStatus | undefined;
}) {
  return (
    <Switch>
      <Match when={props.status === SyncSourceStatus.Disconnected}>
        <Tooltip
          as="span"
          label="You're offline. Changes will sync when you reconnect."
        >
          <span
            role="status"
            aria-label="Offline"
            class="inline-flex size-6 shrink-0 items-center justify-center rounded-md border border-alert/20 bg-alert-bg text-alert-ink [&>svg]:size-4"
          >
            <CloudWarningIcon />
          </span>
        </Tooltip>
      </Match>
      <Match when={props.status === SyncSourceStatus.Connecting}>
        <Tooltip as="span" label="Reconnecting…">
          <span
            role="status"
            aria-label="Reconnecting"
            class="inline-flex size-6 shrink-0 items-center justify-center rounded-md border border-transparent text-ink-extra-muted [&>svg]:size-4"
          >
            <CloudIcon class="animate-pulse" />
          </span>
        </Tooltip>
      </Match>
    </Switch>
  );
}
