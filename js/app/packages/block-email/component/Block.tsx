import { useGlobalNotificationSource } from '@app/component/GlobalAppState';
import { withAnalytics } from '@coparse/analytics';
import { DocumentBlockContainer } from '@core/component/DocumentBlockContainer';
import { EmailDebouncedReadMarker } from '@notifications';
import { useMarkThreadAsSeenMutation } from '@queries/email/thread';
import { createEffect, createMemo, onMount, Show } from 'solid-js';
import { blockDataSignal } from '../signal/emailBlockData';
import { Email } from './Email';

const { track, TrackingEvents } = withAnalytics();

export default function BlockEmail() {
  const blockData = blockDataSignal.get;
  const notificationSource = useGlobalNotificationSource();
  const markSeenMutation = useMarkThreadAsSeenMutation();

  const title = createMemo(() => {
    const data = blockData();
    if (!data || !data.thread || data.thread.messages.length === 0) return '';
    if (data.thread.messages[0].subject?.length === 0) return '[No subject]';
    return data.thread.messages[0].subject!;
  });

  const threadId = createMemo(() => blockData()?.thread?.db_id ?? '');

  onMount(() => {
    track(TrackingEvents.BLOCKEMAIL.OPEN);
  });

  // Mark all messages as read
  createEffect(() => {
    const data = blockData();
    if (!data) return;
    const initialThreadLoad = data.thread;
    if (!initialThreadLoad.db_id) return;

    markSeenMutation.mutate({ threadId: initialThreadLoad.db_id });
  });

  return (
    <DocumentBlockContainer title={title() ?? 'Email'}>
      <div class="size-full bracket-never" tabIndex={-1}>
        <Show when={blockData()}>
          <Show when={threadId()}>
            {(id) => (
              <>
                <EmailDebouncedReadMarker
                  notificationSource={notificationSource}
                  threadId={id()}
                />
                <Email title={title} threadId={id} />
              </>
            )}
          </Show>
        </Show>
      </div>
    </DocumentBlockContainer>
  );
}
