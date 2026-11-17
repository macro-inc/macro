import { ViewShell } from '@app/components/view-shell';
import { pendingDirectMessageRecipient } from '@channel/primitives/pending-direct-messages';
import {
  PendingDirectMessage,
  PendingDirectMessageTitle,
} from '@channel/views/pending-direct-message';
import { RedirectSplit } from '@components/app/split-layout/split-router/app-route-shell';
import { Show } from 'solid-js';

/**
 * Chat's detail for a DM that its first message will create. A temporary id
 * this tab didn't open (a reload, a restored layout) returns to the list.
 */
export function PendingDirectMessageDetail(props: { pendingId: string }) {
  const recipientId = pendingDirectMessageRecipient(props.pendingId);

  return (
    <Show
      when={recipientId}
      keyed
      fallback={
        <RedirectSplit
          to={{ type: 'component', id: 'channels' }}
          mergeHistory
        />
      }
    >
      {(recipient) => (
        <div class="flex size-full min-h-0 flex-col">
          <ViewShell.TopBar class="gap-3 py-0">
            <PendingDirectMessageTitle
              pendingId={props.pendingId}
              recipientId={recipient}
            />
          </ViewShell.TopBar>
          <PendingDirectMessage
            pendingId={props.pendingId}
            recipientId={recipient}
          />
        </div>
      )}
    </Show>
  );
}
