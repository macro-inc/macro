import { useBlockEntityCommands } from '@app/features/next-soup/actions';
import { useGlobalNotificationSource } from '@components/app/GlobalAppState';
import { useSplitPanel } from '@components/app/split-layout/layoutUtils';
import { DocumentBlockContainer } from '@core/component/DocumentBlockContainer';
import { EmailDebouncedReadMarker } from '@notifications';
import { useThreadQuery } from '@queries/email/thread';
import { createMemo, Show, Suspense } from 'solid-js';
import { blockDataSignal } from '../signal/emailBlockData';
import { EmailView } from './Email';

export default function BlockEmail() {
  useBlockEntityCommands();
  const blockData = blockDataSignal.get;
  const notificationSource = useGlobalNotificationSource();
  // A Preview Pair Viewer shows the thread passively — wait longer before
  // marking it seen so scanning/previewing doesn't clear unread state.
  const isPreview = !!useSplitPanel()?.handle.isViewerSplit();

  const threadId = createMemo(() => blockData()?.thread?.db_id ?? '');

  const threadQuery = useThreadQuery(threadId, () => ({
    enabled: !!threadId(),
  }));

  const title = () => {
    const data = threadQuery.data;
    if (!data || !data.thread || data.thread.messages.length === 0) return '';
    if (data.thread.messages[0].subject?.length === 0) return '[No subject]';
    // remove "re:" prefix(es)
    return data.thread.messages[0].subject!.replace(/^(re:\s*)+/i, '');
  };

  return (
    <Suspense>
      <DocumentBlockContainer title={title() ?? 'Email'}>
        <div class="size-full" tabIndex={-1}>
          <Show when={blockData()}>
            <Show when={threadId()}>
              {(id) => (
                <>
                  <EmailDebouncedReadMarker
                    notificationSource={notificationSource}
                    threadId={id()}
                    linkId={threadQuery.data?.thread?.link_id}
                    debounceTime={isPreview ? 1_500 : 100}
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
