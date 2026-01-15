import { useGlobalNotificationSource } from '@app/component/GlobalAppState';
import { withAnalytics } from '@coparse/analytics';
import { DocumentBlockContainer } from '@core/component/DocumentBlockContainer';
import { EmailDebouncedReadMarker } from '@notifications';
import { createMemo, onMount, Show, Suspense } from 'solid-js';
import { blockDataSignal } from '../signal/emailBlockData';
import { EmailView } from './Email';
import { useThreadQuery } from '@queries/email/thread';

const { track, TrackingEvents } = withAnalytics();

export default function BlockEmail() {
  const blockData = blockDataSignal.get;
  const notificationSource = useGlobalNotificationSource();

  const threadId = createMemo(() => blockData()?.thread?.db_id ?? '');

  const threadQuery = useThreadQuery(threadId, () => ({
    enabled: !!threadId(),
  }));

  const title = () => {
    const data = threadQuery.data;
    if (!data || !data.thread || data.thread.messages.length === 0) return '';
    if (data.thread.messages[0].subject?.length === 0) return '[No subject]';
    return data.thread.messages[0].subject!;
  };

  onMount(() => {
    track(TrackingEvents.BLOCKEMAIL.OPEN);
  });

  return (
    <Suspense>
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
                  <Suspense>
                    <EmailView title={title()} threadId={id} />
                  </Suspense>
                </>
              )}
            </Show>
          </Show>
        </div>
      </DocumentBlockContainer>
    </Suspense>
  );
}
