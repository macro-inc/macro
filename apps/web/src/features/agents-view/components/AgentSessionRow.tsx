import { ViewSidebar } from '@app/components/view-shell';
import { cn, pressHandlers } from '@ui';
import { children, type JSX, Show } from 'solid-js';
import {
  type ConversationState,
  conversationStateLabel,
} from '../core/conversation-state';

/** Shared row geometry; the host supplies the Home icon or Agents status. */
export function AgentSessionRow(props: {
  id: string;
  /** The row button's id, for a list that points at its focused row. */
  domId?: string;
  title: string;
  kind: 'chat' | 'code';
  state: ConversationState;
  leading: JSX.Element;
  trailing?: JSX.Element;
  /** Shown at the row's end on hover, above the row's own button. */
  hoverAction?: JSX.Element;
  timestamp: string;
  unread?: boolean;
  failed?: boolean;
  active?: boolean;
  /** The list's keyboard focus, which is not DOM focus. */
  focused?: boolean;
  /** When true, hides the leading icon slot to save horizontal space. */
  hideLeading?: boolean;
  children?: JSX.Element;
  onOpen?: (event: MouseEvent) => void;
}) {
  const metadata = children(() => props.children);
  const hoverAction = children(() => props.hoverAction);
  return (
    <ViewSidebar.Item
      as="div"
      active={props.active}
      class={cn(
        'group/agent-session relative text-ink',
        props.focused && !props.active && 'not-touch:bg-hover',
        metadata.toArray().length > 0 &&
          'h-auto min-h-12 items-start py-1.5 touch:h-auto',
        props.hideLeading && 'pl-3'
      )}
      data-agent-session-row={props.id}
      data-kind={props.kind}
      data-session-state={props.state}
    >
      <button
        id={props.domId}
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
      <Show when={hoverAction()}>
        <span class="relative hidden shrink-0 group-hover/agent-session:flex">
          {hoverAction()}
        </span>
      </Show>
    </ViewSidebar.Item>
  );
}

/** One dot combines turn failure, activity, and unread state. */
export function AgentSessionStatusIndicator(props: {
  state: ConversationState;
  unread?: boolean;
  failed?: boolean;
}) {
  return (
    <Show
      when={
        props.state === 'starting' ||
        props.state === 'working' ||
        props.state === 'waiting' ||
        props.failed ||
        props.unread
      }
    >
      <span
        data-agent-status-indicator
        aria-label={props.unread ? 'Unread' : undefined}
        class={cn(
          'size-1.5 shrink-0 rounded-full',
          props.failed && 'bg-failure',
          !props.failed &&
            (props.state === 'waiting' ? 'bg-warning' : 'bg-accent'),
          !props.failed &&
            (props.state === 'starting' || props.state === 'working') &&
            'motion-safe:animate-pulse'
        )}
      />
    </Show>
  );
}
