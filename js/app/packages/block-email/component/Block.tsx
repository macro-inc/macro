import { useGlobalNotificationSource } from '@app/component/GlobalAppState';
import { withAnalytics } from '@coparse/analytics';
import { DocumentBlockContainer } from '@core/component/DocumentBlockContainer';
import { EmailDebouncedReadMarker } from '@notifications/components/DebouncedNotificationReadMarker';
import { createEffect, createMemo, onMount, Show } from 'solid-js';
import { markThreadAsSeen } from '../signal/email';
import { blockDataSignal } from '../signal/emailBlockData';
import { createThreadMessagesResource } from '../signal/threadMessages';
import { Email } from './Email';

const { track, TrackingEvents } = withAnalytics();

export default function BlockEmail() {
  const blockData = blockDataSignal.get;
  const notificationSource = useGlobalNotificationSource();

  const title = createMemo(() => {
    const data = blockData();
    if (!data || !data.thread || data.thread.messages.length === 0) return '';
    if (data.thread.messages[0].subject?.length === 0) return '[No subject]';
    return data.thread.messages[0].subject!;
  });

  const threadMessagesResource = createMemo(() => {
    const data = blockData();
    const threadId = data?.thread?.db_id;
    return threadId
      ? createThreadMessagesResource(threadId, data.thread)
      : null;
  });

  const threadData = createMemo(() => {
    const resource = threadMessagesResource();
    const resourceData = resource?.resource();
    return resourceData?.thread;
  });

  onMount(() => {
    track(TrackingEvents.BLOCKEMAIL.OPEN);
  });

  // Mark all messages as read
  createEffect(() => {
    const data = blockData();
    if (!data) return;
    let initialThreadLoad = data.thread;
    if (!initialThreadLoad.db_id) return;

    markThreadAsSeen(initialThreadLoad.db_id);
  });

  return (
    <DocumentBlockContainer title={title() ?? 'Email'}>
      <div class="size-full bracket-never" tabIndex={-1}>
        <Show when={blockData()}>
          <Show when={blockData()?.thread?.db_id}>
            {(threadId) => {
              return (
                <EmailDebouncedReadMarker
                  notificationSource={notificationSource}
                  threadId={threadId()}
                />
              );
            }}
          </Show>

          <Email
            title={title}
            threadMessagesResource={threadMessagesResource}
            threadData={threadData}
          />
        </Show>
      </div>
    </DocumentBlockContainer>
  );
}
