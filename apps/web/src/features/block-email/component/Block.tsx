import { useBlockEntityCommands } from '@app/features/next-soup/actions';
import { useGlobalNotificationSource } from '@components/app/GlobalAppState';
import { useSplitPanel } from '@components/app/split-layout/layoutUtils';
import { useBlockId } from '@core/block';
import { DocumentBlockContainer } from '@core/component/DocumentBlockContainer';
import { buildEntityData } from '@entity';
import { EmailDebouncedReadMarker } from '@notifications';
import { useThreadQuery } from '@queries/email/thread';
import { createMemo, Show, Suspense } from 'solid-js';
import { blockDataSignal } from '../signal/emailBlockData';
import { displaySubject } from '../util/subjectText';
import { EmailView } from './Email';

export default function BlockEmail() {
  const blockData = blockDataSignal.get;
  const blockId = useBlockId();

  // Email threads are absent from quick access, so the entity the block-level
  // commands act on has to come from here. Built off the block's loaded data
  // rather than `threadQuery` because command-menu conditions read it outside a
  // Suspense boundary.
  const commandEntity = createMemo(() => {
    const thread = blockData()?.thread;
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
  const notificationSource = useGlobalNotificationSource();
  // A Preview Pair Viewer shows the thread passively — wait longer before
  // marking it seen so scanning/previewing doesn't clear unread state.
  const isPreview = !!useSplitPanel()?.handle.isViewerSplit();

  const threadId = () => blockId;

  const threadQuery = useThreadQuery(threadId, () => ({
    enabled: !!threadId(),
  }));

  const title = () => {
    const data = threadQuery.data;
    if (!data || !data.thread || data.thread.messages.length === 0) return '';
    return displaySubject(data.thread.messages[0].subject);
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
