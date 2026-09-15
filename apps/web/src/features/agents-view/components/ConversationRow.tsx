import { ViewSidebar } from '@app/components/view-shell';
import { EntityRowIcon } from '@entity';
import { cn } from '@ui';
import { Show } from 'solid-js';
import {
  type ConversationState,
  conversationState,
  conversationStateLabel,
} from '../core/conversation-state';
import { compactAge } from '../core/format-age';
import type { AgentsMode } from '../core/mode';
import {
  type AgentConversationEntity,
  conversationTimestamp,
} from '../core/recent-conversations';

export function conversationTitle(
  conversation: Pick<AgentConversationEntity, 'name'>
): string {
  return conversation.name || 'Untitled chat';
}

/**
 * One recent conversation. Chat rows are a title and an age. Code rows add
 * the coder and the runtime's state beneath the title, and a dot on the icon
 * while the runtime is up.
 */
export function ConversationRow(props: {
  conversation: AgentConversationEntity;
  mode: AgentsMode;
  active: boolean;
  onOpen: () => void;
}) {
  const state = (): ConversationState | undefined =>
    props.conversation.type === 'agent_session'
      ? conversationState(props.conversation.status)
      : undefined;
  const indicator = () => {
    if (props.mode !== 'code') return undefined;
    const current = state();
    return current === 'ended' ? undefined : current;
  };
  const age = () => compactAge(conversationTimestamp(props.conversation));
  const detail = () => {
    if (props.mode !== 'code' || props.conversation.type !== 'agent_session')
      return undefined;
    const bot = props.conversation.bot?.name;
    const current = state();
    return [bot, current ? conversationStateLabel(current) : undefined]
      .filter(Boolean)
      .join(' · ');
  };

  return (
    <ViewSidebar.Item
      active={props.active}
      class={cn(
        'grid grid-cols-[1rem_minmax(0,1fr)_auto] gap-x-2.5 font-normal',
        detail() && 'h-auto min-h-9 grid-rows-[auto_auto] gap-y-0.5 py-1.5'
      )}
      title={conversationTitle(props.conversation)}
      onClick={props.onOpen}
    >
      <span
        class={cn(
          'relative flex size-4 shrink-0 items-center justify-center',
          detail() && 'row-span-2 mt-0.5 self-start'
        )}
      >
        <EntityRowIcon entity={props.conversation} class="size-4" />
        <Show when={indicator()}>
          {(kind) => (
            <span
              aria-hidden="true"
              class={cn(
                'absolute -top-0.5 -right-1 size-1.5 rounded-full ring-2 ring-panel',
                kind() === 'live'
                  ? 'bg-success'
                  : 'bg-ink-placeholder motion-safe:animate-pulse'
              )}
            />
          )}
        </Show>
      </span>
      <span class="truncate">{conversationTitle(props.conversation)}</span>
      <span class="text-xs tabular-nums text-ink-placeholder">{age()}</span>
      <Show when={detail()}>
        {(text) => (
          <span class="col-span-2 truncate text-xs text-ink-placeholder">
            {text()}
          </span>
        )}
      </Show>
    </ViewSidebar.Item>
  );
}
