import { ViewShell } from '@app/components/view-shell';
import { ChannelDetailLayout } from '@channel/Channel/ChannelDetailLayout';
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
        <ChannelDetailLayout
          scrollBehindHeader
          header={
            <ViewShell.TopBar class="gap-3 py-0 touch:flex touch:h-10 touch:px-0 touch:py-0">
              <ViewShell.TopBarTitle class="px-3">
                <PendingDirectMessageTitle
                  pendingId={props.pendingId}
                  recipientId={recipient}
                />
              </ViewShell.TopBarTitle>
            </ViewShell.TopBar>
          }
        >
          <PendingDirectMessage
            pendingId={props.pendingId}
            recipientId={recipient}
          />
        </ChannelDetailLayout>
      )}
    </Show>
  );
}
