import { useBlockEntityCommands } from '@app/features/next-soup/actions';
import { useGlobalNotificationSource } from '@components/app/GlobalAppState';
import { useSplitPanel } from '@components/app/split-layout/layoutUtils';
import { useBlockId } from '@core/block';
import { DocumentBlockContainer } from '@core/component/DocumentBlockContainer';
import {
  EntityLoadGate,
  toEntityLoadError,
} from '@core/component/EntityLoadGate';
import { buildEntityData } from '@entity';
import { EmailDebouncedReadMarker } from '@notifications';
import { useThreadQuery } from '@queries/email/thread';
import { createMemo, Show, Suspense } from 'solid-js';
import { displaySubject } from '../util/subjectText';
import { EmailView } from './Email';

export default function BlockEmail() {
  const blockId = useBlockId();

  const threadId = () => blockId;

  const threadQuery = useThreadQuery(threadId, () => ({
    enabled: !!threadId(),
  }));

  // Email threads are absent from quick access, so the entity the block-level
  // commands act on has to come from here. Gated on isSuccess so the
  // command-menu conditions, which read this outside a Suspense boundary,
  // never touch pending query data.
  const commandEntity = createMemo(() => {
    if (!threadQuery.isSuccess) return undefined;
    const thread = threadQuery.data?.thread;
    if (!thread) return undefined;
    return buildEntityData({
      id: thread.db_id,
      name: displaySubject(thread.messages[0]?.subject),
      blockName: 'email',
      isRead: thread.is_read,
      done: !thread.inbox_visible,
    });
  });

  useBlockEntityCommands(commandEntity);

  // The gate owns the load policy: structural errors are authoritative even
  // over cached data, a transport failure over cached data still renders the
  // thread, and an offline load with nothing cached gates as the retryable
  // state. Loader-level errors (e.g. an invalid source) still reach
  // DocumentBlockContainer through blockErrorSignal.
  const threadLoadResult = {
    data: () => threadQuery.data,
    error: () =>
      threadQuery.isError ? toEntityLoadError(threadQuery.error) : undefined,
    isPending: () => threadQuery.isLoading,
  };

  const notificationSource = useGlobalNotificationSource();
  // A Preview Pair Viewer shows the thread passively — wait longer before
  // marking it seen so scanning/previewing doesn't clear unread state.
  const isPreview = !!useSplitPanel()?.handle.isViewerSplit();

  const title = () => {
    const data = threadQuery.data;
    if (!data || !data.thread || data.thread.messages.length === 0) return '';
    return displaySubject(data.thread.messages[0].subject);
  };

  return (
    <Suspense>
      <DocumentBlockContainer title={title() ?? 'Email'}>
        <div class="size-full" tabIndex={-1}>
          <EntityLoadGate
            result={threadLoadResult}
            loadErrorTitle="Unable to load this email"
            onRetry={() => void threadQuery.refetch()}
          >
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
          </EntityLoadGate>
        </div>
      </DocumentBlockContainer>
    </Suspense>
  );
}
