import { ViewSidebar } from '@app/components/view-shell';
import { cn, pressHandlers, Spinner } from '@ui';
import { children, type JSX, Show } from 'solid-js';
import {
  type ConversationState,
  conversationStateLabel,
} from '../core/conversation-state';

/** Shared row geometry; the host supplies the Home icon or Agents status. */
export function AgentSessionRow(props: {
  id: string;
  title: string;
  kind: 'chat' | 'code';
  state: ConversationState;
  leading: JSX.Element;
  trailing?: JSX.Element;
  timestamp: string;
  unread?: boolean;
  failed?: boolean;
  active?: boolean;
  /** When true, hides the leading icon slot to save horizontal space. */
  hideLeading?: boolean;
  children?: JSX.Element;
  onOpen?: (event: MouseEvent) => void;
}) {
  const metadata = children(() => props.children);
  return (
    <ViewSidebar.Item
      as="div"
      active={props.active}
      class={cn(
        'relative text-ink',
        metadata.toArray().length > 0 &&
          'h-auto min-h-12 items-start py-1.5 touch:h-auto',
        props.hideLeading && 'pl-3'
      )}
      data-agent-session-row={props.id}
      data-kind={props.kind}
      data-session-state={props.state}
    >
      <button
        type="button"
        class="absolute inset-0 rounded-lg outline-none focus-visible:outline-2 focus-visible:outline-accent"
        aria-label={props.title}
        aria-description={[
          props.failed
            ? 'Last turn failed'
            : conversationStateLabel(props.state),
          props.unread ? 'Unread' : undefined,
        ]
          .filter(Boolean)
          .join(' · ')}
        aria-current={props.active ? 'page' : undefined}
        {...pressHandlers((event) => props.onOpen?.(event))}
      />
      <Show when={!props.hideLeading}>
        <ViewSidebar.Icon class="pointer-events-none relative text-ink-muted">
          {props.leading}
        </ViewSidebar.Icon>
      </Show>
      <span class="pointer-events-none relative min-w-0 flex-1">
        <span class="flex min-w-0 items-center gap-2">
          <span class="min-w-0 flex-1 truncate">{props.title}</span>
          <span class="shrink-0 text-xs text-ink-extra-muted tabular-nums">
            {props.timestamp}
          </span>
          {props.trailing}
        </span>
        {metadata()}
      </span>
    </ViewSidebar.Item>
  );
}

/**
 * A spinner while the agent works; otherwise one dot for failure, a question
 * waiting on you, or unread output.
 */
export function AgentSessionStatusIndicator(props: {
  state: ConversationState;
  unread?: boolean;
  failed?: boolean;
}) {
  const busy = () =>
    !props.failed && (props.state === 'starting' || props.state === 'working');
  const label = () => (props.unread ? 'Unread' : undefined);

  return (
    <Show
      when={busy()}
      fallback={
        <Show when={props.state === 'waiting' || props.failed || props.unread}>
          <span
            data-agent-status-indicator
            aria-label={label()}
            class={cn(
              'size-1.5 shrink-0 rounded-full',
              props.failed && 'bg-failure',
              !props.failed &&
                (props.state === 'waiting' ? 'bg-warning' : 'bg-accent')
            )}
          />
        </Show>
      }
    >
      <span
        data-agent-status-indicator
        data-agent-working
        aria-label={label()}
        class="flex shrink-0 text-accent"
      >
        <Spinner decorative size="sm" class="size-3" />
      </span>
    </Show>
  );
}
