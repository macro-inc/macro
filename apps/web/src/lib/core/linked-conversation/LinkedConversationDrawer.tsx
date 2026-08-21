import { navigateToChannelMessage } from '@block-channel/utils/link';
import { EditableThread } from '@channel/StandaloneThread';
import { useGlobalBlockOrchestrator } from '@components/app/GlobalAppState';
import { SplitDrawer } from '@components/app/split-layout/components/SplitDrawer';
import { useDrawerControl } from '@components/app/split-layout/components/SplitDrawerContext';
import { StaticMarkdownContext } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import ArrowSquareOut from '@phosphor/arrow-square-out.svg';
import { Button } from '@ui';

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
 * channel + root message ids.
 *
 * The thread itself is the native standalone `EditableThread`: send, quote-
 * reply, react, and the rest of the channel message actions work in place.
 * The header button still jumps to the thread in its channel.
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
      />
    </SplitDrawer>
  );
}

/**
 * Separate component so the thread queries mount only while the drawer is
 * open — `SplitDrawer` only creates its children then.
 */
function DrawerConversation(props: { channelId: string; messageId: string }) {
  return (
    <StaticMarkdownContext>
      <EditableThread
        channelId={props.channelId}
        messageId={props.messageId}
        defaultReplying
      />
    </StaticMarkdownContext>
  );
}
