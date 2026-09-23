import { ViewSidebar } from '@app/components/view-shell';
import { cn, pressHandlers, Tooltip } from '@ui';
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
  detailsLabel?: string;
  unread?: boolean;
  active?: boolean;
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
          'h-auto min-h-12 items-start py-1.5 touch:h-auto'
      )}
      data-agent-session-row={props.id}
      data-kind={props.kind}
      data-session-state={props.state}
    >
      <Tooltip
        label={[
          props.title,
          conversationStateLabel(props.state),
          props.unread ? 'Unread' : undefined,
          props.detailsLabel,
        ]
          .filter(Boolean)
          .join(' · ')}
        class="absolute inset-0"
        placement="right"
      >
        <button
          type="button"
          class="absolute inset-0 rounded-lg outline-none focus-visible:outline-2 focus-visible:outline-accent"
          aria-label={props.title}
          aria-description={[
            conversationStateLabel(props.state),
            props.unread ? 'Unread' : undefined,
          ]
            .filter(Boolean)
            .join(' · ')}
          aria-current={props.active ? 'page' : undefined}
          {...pressHandlers((event) => props.onOpen?.(event))}
        />
      </Tooltip>
      <ViewSidebar.Icon class="pointer-events-none relative text-ink-muted">
        {props.leading}
      </ViewSidebar.Icon>
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

/** One leading dot combines activity and unread state; read dormant rows are empty. */
export function AgentSessionStatusIndicator(props: {
  state: ConversationState;
  unread?: boolean;
}) {
  return (
    <Show
      when={
        props.state === 'starting' ||
        props.state === 'working' ||
        props.state === 'waiting' ||
        props.unread
      }
    >
      <span
        data-agent-status-indicator
        aria-label={props.unread ? 'Unread' : undefined}
        class={cn(
          'size-1.5 rounded-full',
          props.state === 'waiting' ? 'bg-warning' : 'bg-accent',
          (props.state === 'starting' || props.state === 'working') &&
            'motion-safe:animate-pulse'
        )}
      />
    </Show>
  );
}
