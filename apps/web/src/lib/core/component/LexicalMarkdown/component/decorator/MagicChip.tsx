import { useSplitLayout } from '@components/app/split-layout/layout';
import type {
  MagicChipDecoratorProps,
  MagicChipStatus,
} from '@macro-inc/lexical-core';
import type { Component } from 'solid-js';

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
