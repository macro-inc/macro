import { navigateToChannelMessage } from '@block-channel/utils/link';
import { useGlobalBlockOrchestrator } from '@components/app/GlobalAppState';
import { SplitDrawer } from '@components/app/split-layout/components/SplitDrawer';
import { useDrawerControl } from '@components/app/split-layout/components/SplitDrawerContext';
import { openDocument } from '@core/component/LexicalMarkdown/component/core/BlockLink';
import ArrowSquareOut from '@phosphor/arrow-square-out.svg';
import { useDocumentMetadataQuery } from '@queries/storage/document-metadata';
import type { MessageParent } from '@service-storage/messages';
import { createCallback } from '@solid-primitives/rootless';
import { Button } from '@ui';
import { Show } from 'solid-js';
import { LinkedConversation } from './LinkedConversation';
import { createMessageThreadSource } from './message-thread-source';

type LinkedConversationDrawerProps = {
  /**
   * Drawer id, unique within the split. Toggle the drawer from anywhere in
   * the same split (e.g. a toolbar `BlockTool`) with `useDrawerControl(id)`.
   */
  id: string;
  /** Document or channel containing the linked thread. */
  parent: MessageParent;
  /** Root message of the linked thread — the conversation's parent id. */
  messageId: string;
  /** Target drawer width in px. */
  size?: number;
};

/**
 * A right-hand [`SplitDrawer`] rendering an originating message thread inside the current split — the "show the thread this came from"
 * affordance. Fully decoupled from any block: it only needs the thread's
 * parent + root message ids. Clicking a message (or the open button in the
 * drawer header) navigates to the referenced thread in its parent and
 * closes the drawer.
 */
export function LinkedConversationDrawer(props: LinkedConversationDrawerProps) {
  const orchestrator = useGlobalBlockOrchestrator();
  const drawer = useDrawerControl(props.id);

  const document = useDocumentMetadataQuery(() =>
    props.parent.type === 'document' ? props.parent.id : ''
  );
  const openInParent = createCallback((clickedMessageId?: string) => {
    const target = clickedMessageId ?? props.messageId;
    const isReply = target !== props.messageId;
    if (props.parent.type === 'channel') {
      void navigateToChannelMessage(
        orchestrator,
        props.parent.id,
        target,
        isReply ? props.messageId : undefined
      );
    } else if (document.isSuccess && document.data.fileType) {
      openDocument(
        document.data.fileType,
        props.parent.id,
        { comment_id: target },
        true
      );
    } else {
      return;
    }
    drawer.close();
  });

  return (
    <SplitDrawer
      id={props.id}
      side="right"
      size={props.size ?? 420}
      title={
        <Button
          variant="ghost"
          size="icon-sm"
          label="Open thread"
          onClick={() => openInParent()}
        >
          <ArrowSquareOut />
        </Button>
      }
    >
      <DrawerConversation
        parent={props.parent}
        messageId={props.messageId}
        onOpenMessage={openInParent}
      />
    </SplitDrawer>
  );
}

/**
 * Separate component so the thread queries mount only while the drawer is
 * open — `SplitDrawer` only creates its children then.
 */
function DrawerConversation(props: {
  parent: MessageParent;
  messageId: string;
  onOpenMessage: (messageId: string) => void;
}) {
  const source = createMessageThreadSource(
    () => props.parent,
    () => props.messageId
  );

  return (
    <Show
      when={source.root()}
      fallback={
        <p class="px-2 text-sm text-ink-muted">
          {source.unavailable?.()
            ? 'This thread is unavailable.'
            : 'Loading thread…'}
        </p>
      }
    >
      <LinkedConversation
        source={source}
        onClickMessage={(messageId, e) => {
          e.stopPropagation();
          props.onOpenMessage(messageId);
        }}
      />
    </Show>
  );
}
