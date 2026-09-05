import { navigateToChannelMessage } from '@block-channel/utils/link';
import { useGlobalBlockOrchestrator } from '@components/app/GlobalAppState';
import { SplitDrawer } from '@components/app/split-layout/components/SplitDrawer';
import { useDrawerControl } from '@components/app/split-layout/components/SplitDrawerContext';
import ArrowSquareOut from '@phosphor/arrow-square-out.svg';
import { Button } from '@ui';
import { Show } from 'solid-js';
import { createChannelThreadSource } from './channel-thread-source';
import { LinkedConversation } from './LinkedConversation';

type LinkedConversationDrawerProps = {
  /**
   * Drawer id, unique within the split. Toggle the drawer from anywhere in
   * the same split (e.g. a toolbar `BlockTool`) with `useDrawerControl(id)`.
   */
  id: string;
  /** Channel containing the linked thread. */
  channelId: string;
  /** Root message of the linked thread — the conversation's parent id. */
  messageId: string;
  /** Target drawer width in px. */
  size?: number;
};

/**
 * A right-hand [`SplitDrawer`] rendering a linked conversation (a channel
 * thread) inside the current split — the "show the thread this came from"
 * affordance. Fully decoupled from any block: it only needs the thread's
 * channel + root message ids. Clicking a message (or the open button in the
 * drawer header) navigates to the referenced thread in its channel and
 * closes the drawer.
 */
export function LinkedConversationDrawer(props: LinkedConversationDrawerProps) {
  const orchestrator = useGlobalBlockOrchestrator();
  const drawer = useDrawerControl(props.id);

  const openInChannel = (clickedMessageId?: string) => {
    const target = clickedMessageId ?? props.messageId;
    const isReply = target !== props.messageId;
    void navigateToChannelMessage(
      orchestrator,
      props.channelId,
      target,
      isReply ? props.messageId : undefined
    );
    drawer.close();
  };

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
          onClick={() => openInChannel()}
        >
          <ArrowSquareOut />
        </Button>
      }
    >
      <DrawerConversation
        channelId={props.channelId}
        messageId={props.messageId}
        onOpenMessage={openInChannel}
      />
    </SplitDrawer>
  );
}

/**
 * Separate component so the thread queries mount only while the drawer is
 * open — `SplitDrawer` only creates its children then.
 */
function DrawerConversation(props: {
  channelId: string;
  messageId: string;
  onOpenMessage: (messageId: string) => void;
}) {
  const source = createChannelThreadSource({
    channelId: () => props.channelId,
    messageId: () => props.messageId,
  });

  return (
    <Show
      when={source.root()}
      fallback={<p class="px-2 text-sm text-ink-muted">Loading thread…</p>}
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
