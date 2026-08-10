import { useSplitLayout } from '@components/app/split-layout/layout';
import { sessionMessages } from '@core/agent-fold/client';
import type {
  MagicChipDecoratorProps,
  MagicChipStatus,
} from '@macro-inc/lexical-core';
import { subscribeAgentSessionLog } from '@queries/channel/agent-session-stream';
import { createFoldedMessages } from '@queries/channel/folded-messages';
import { type Component, createEffect, onCleanup } from 'solid-js';

const STATUS_LABELS: Record<MagicChipStatus, string> = {
  no_messages: 'Starting',
  booting: 'Booting',
  acp_ready: 'Ready',
  shutting_down: 'Shutting down',
  disconnected: 'Disconnected',
};

/** Static agent-session status chip that opens its dedicated channel. */
export const MagicChip: Component<MagicChipDecoratorProps> = (props) => {
  const { replaceOrInsertSplit } = useSplitLayout();
  console.log('magic chip', props);

  const foldedMessages = createFoldedMessages(() => props.channelId);
  const logFoldedMessages = () => {
    void sessionMessages(props.agentSessionId)
      .then((messages) => {
        console.info('[magic-chip] folded session messages', {
          agentSessionId: props.agentSessionId,
          messages,
        });
      })
      .catch(() => {
        // Historical catch-up may still be opening the session's fold machine.
      });
  };

  createEffect(() => {
    if (foldedMessages()) logFoldedMessages();
  });

  const unsubscribe = subscribeAgentSessionLog(
    props.agentSessionId,
    (event) => {
      console.info('[magic-chip] ACP message', {
        agentSessionId: event.agentSessionId,
        direction: event.direction,
        content: event.content,
      });
      logFoldedMessages();
    }
  );
  onCleanup(unsubscribe);

  return (
    <button
      type="button"
      class="pointer-events-auto inline-flex items-center gap-1.5 rounded-full border border-edge bg-surface px-2 py-0.5 text-xs font-medium text-ink-muted hover:bg-hover hover:text-ink"
      data-magic-chip={props.agentSessionId}
      onMouseDown={(event) => event.preventDefault()}
      onClick={() =>
        replaceOrInsertSplit({ type: 'channel', id: props.channelId })
      }
    >
      <span class="size-1.5 shrink-0 rounded-full bg-accent" />
      {STATUS_LABELS[props.status]}
    </button>
  );
};
