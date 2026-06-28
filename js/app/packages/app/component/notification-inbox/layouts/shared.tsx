import {
  EntityIcon,
  type EntityIconSelector,
} from '@core/component/EntityIcon';
import GithubIcon from '@icon/mcp-github.svg';
import ArrowBendUpLeftIcon from '@phosphor-icons/core/regular/arrow-bend-up-left.svg?component-solid';
import AtIcon from '@phosphor-icons/core/regular/at.svg?component-solid';
import ChatCircleIcon from '@phosphor-icons/core/regular/chat-circle.svg?component-solid';
import ChatTextIcon from '@phosphor-icons/core/regular/chat-text.svg?component-solid';
import PhoneIcon from '@phosphor-icons/core/regular/phone.svg?component-solid';
import UserPlusIcon from '@phosphor-icons/core/regular/user-plus.svg?component-solid';
import { cn, Layer } from '@ui';
import { type JSX, Show } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import {
  InboxItem,
  type InboxItem as InboxItemData,
  type InboxRelatedDocument,
  useInboxItemSenderName,
} from '../InboxItem';
import {
  formatCompactRelativeTimestamp,
  getActionText,
  getDisplayLocation,
  getInboxItemIconTarget,
  getNotificationTag,
  getSenderFirstName,
  isGroupedChannelThread,
  uniqueItemsBySender,
} from './utils';

export interface InboxItemLayoutProps {
  item: InboxItemData;
  unread?: boolean;
  selected?: boolean;
  highlighted?: boolean;
  expanded?: boolean;
  nested?: boolean;
  onClick?: (event: MouseEvent) => void;
  onSelectRelatedDocument?: (document: InboxRelatedDocument) => void;
  onToggleExpanded?: () => void;
}

export function InboxItemCard(props: {
  unread?: boolean;
  selected?: boolean;
  highlighted?: boolean;
  onClick?: (event: MouseEvent) => void;
  children: JSX.Element;
}) {
  const interactive = () => Boolean(props.onClick);
  const onKeyDown = (event: KeyboardEvent) => {
    if (!interactive()) return;
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    props.onClick?.(event as unknown as MouseEvent);
  };

  return (
    <div
      class={cn(
        'col-span-3', // Temporary
        'group/inbox-item grid w-full grid-cols-[0.5rem_var(--inbox-item-icon-size)_minmax(0,1fr)] gap-x-3 text-sm',
        '[--inbox-item-icon-size:2rem]'
      )}
    >
      <div class="col-span-3 grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2">
        <div
          class={cn(
            'col-span-3 grid w-full grid-cols-[0.5rem_var(--inbox-item-icon-size)_minmax(0,1fr)] rounded-lg bg-surface px-2 py-1.5',
            'relative min-h-16 grid-cols-[var(--inbox-item-icon-size)_minmax(0,1fr)] items-center gap-x-3 transition-opacity !ring-0 hover:opacity-100 hover:!ring-0 [--inbox-item-icon-size:2.5rem]',
            props.unread === false && 'opacity-80',
            !props.selected &&
              !props.highlighted &&
              'hover:bg-active/40 hover:ring hover:ring-edge-muted hover:ring-inset',
            props.highlighted && 'bg-active/50 ring ring-edge-muted ring-inset',
            props.selected && 'bg-active/50 opacity-100',
            interactive() &&
              'outline-none focus-visible:bg-accent/10 focus-visible:ring focus-visible:ring-accent/40 focus-visible:ring-inset'
          )}
          role={interactive() ? 'button' : undefined}
          tabIndex={interactive() ? 0 : undefined}
          onClick={props.onClick}
          onKeyDown={onKeyDown}
        >
          {props.children}
        </div>
      </div>
    </div>
  );
}

type ActionIcon = (props: { class?: string }) => JSX.Element;

function actionBubbleIcon(tag: string | undefined): ActionIcon | undefined {
  if (!tag) return undefined;
  if (
    [
      'channel_mention',
      'document_mention',
      'mentioned_in_document_comment',
      'github_pr_mention',
    ].includes(tag)
  ) {
    return AtIcon;
  }
  if (
    [
      'channel_message_reply',
      'replied_to_document_comment_thread',
      'github_pr_review',
    ].includes(tag)
  ) {
    return ArrowBendUpLeftIcon;
  }
  if (['commented_on_document', 'github_pr_comment'].includes(tag)) {
    return ChatCircleIcon;
  }
  if (tag === 'channel_message_send') return ChatTextIcon;
  if (tag === 'channel_invite' || tag === 'invite_to_team') return UserPlusIcon;
  if (tag === 'call_started' || tag === 'call-started') return PhoneIcon;
  if (tag.startsWith('github_')) return GithubIcon;
  return undefined;
}

function actionBubbleEntityTarget(
  tag: string | undefined
): EntityIconSelector | undefined {
  if (tag === 'task_assigned') return 'task';
  if (tag === 'new_email') return 'email';
  if (tag === 'ai_response') return 'chat';
  return undefined;
}

export function InboxItemActionBubble(props: { item: InboxItemData }) {
  const tag = () => getNotificationTag(props.item);
  const entityTarget = () => actionBubbleEntityTarget(tag());
  const icon = () => actionBubbleIcon(tag());

  return (
    <Show when={entityTarget() || icon()}>
      <span class="absolute -bottom-1 -right-1 grid size-5 place-items-center overflow-hidden rounded-full bg-surface text-ink-muted ring-2 ring-surface">
        <Show
          when={entityTarget()}
          fallback={
            <Show when={icon()}>
              {(Icon) => <Dynamic component={Icon()} class="size-3" />}
            </Show>
          }
        >
          {(target) => (
            <span class="grid size-3 place-items-center">
              <EntityIcon targetType={target()} size="fill" />
            </span>
          )}
        </Show>
      </span>
    </Show>
  );
}

export function InboxItemLeadingAvatar(props: { item: InboxItemData }) {
  return (
    <span class="relative inline-flex shrink-0 self-start">
      <InboxItem.Sender
        item={props.item}
        showName={false}
        avatarClass="size-10 bg-active text-xs text-ink-muted"
      />
      <InboxItemActionBubble item={props.item} />
    </span>
  );
}

export function InboxItemLeadingGroupIcon(props: { item: InboxItemData }) {
  return (
    <span class="self-start">
      <Layer depth={3}>
        <div class="grid size-10 shrink-0 place-items-center rounded-full bg-gradient-to-br from-active to-active-hover p-2.5 text-ink-extra-muted">
          <Show
            when={isGroupedChannelThread(props.item)}
            fallback={
              <Show
                when={getNotificationTag(props.item)?.startsWith('github_')}
                fallback={
                  <EntityIcon
                    targetType={getInboxItemIconTarget(props.item)}
                    size="fill"
                    theme="monochrome"
                  />
                }
              >
                <GithubIcon class="size-full" />
              </Show>
            }
          >
            <ChatTextIcon class="size-full" />
          </Show>
        </div>
      </Layer>
    </span>
  );
}

export function InboxItemBody(props: {
  class?: string;
  children: JSX.Element;
}) {
  return (
    <div class={cn('flex min-w-0 flex-col gap-0.5', props.class)}>
      {props.children}
    </div>
  );
}

export function InboxItemActionRow(props: {
  unread?: boolean;
  class?: string;
  children: JSX.Element;
}) {
  return (
    <div
      class={cn(
        'flex min-w-0 items-center gap-1 text-sm',
        props.unread ? 'text-ink' : 'text-ink-extra-muted',
        props.class
      )}
    >
      {props.children}
    </div>
  );
}

export function InboxItemActionText(props: {
  item: InboxItemData;
  nested?: boolean;
}) {
  const senderName = useInboxItemSenderName(() => props.item);
  const text = () =>
    [
      senderName(),
      getActionText(props.item, props.nested),
      getDisplayLocation(props.item, props.nested),
    ]
      .filter(Boolean)
      .join(' ');
  return <span class="min-w-0 flex-1 truncate">{text()}</span>;
}

export function InboxItemBadge(props: {
  count?: number;
  countUnread?: boolean;
  unread?: boolean;
}) {
  return (
    <Show when={props.count || props.unread}>
      <span class="ml-auto flex shrink-0 items-center">
        <Show
          when={props.count}
          fallback={<span class="size-2 rounded-full bg-accent" />}
        >
          {(count) => (
            <span
              class={cn(
                'grid h-4 min-w-4 place-items-center rounded px-1 text-xs',
                props.countUnread
                  ? 'bg-accent/10 text-accent'
                  : 'bg-ink-muted/10 text-ink-muted'
              )}
            >
              {count()}
            </span>
          )}
        </Show>
      </span>
    </Show>
  );
}

export function InboxItemContentRow(props: {
  class?: string;
  children: JSX.Element;
}) {
  return (
    <div
      class={cn('flex min-w-0 items-center gap-2 empty:hidden', props.class)}
    >
      {props.children}
    </div>
  );
}

export function InboxItemSenderSummary(props: { items: InboxItemData[] }) {
  const uniqueSenders = () => uniqueItemsBySender(props.items);
  const firstSender = () => uniqueSenders()[0];
  const secondSender = () => uniqueSenders()[1];
  const overflow = () => Math.max(0, uniqueSenders().length - 1);

  return (
    <Show
      when={uniqueSenders().length > 2}
      fallback={
        <>
          <Show when={firstSender()}>
            {(sender) => getSenderFirstName(sender())}
          </Show>
          <Show when={secondSender()}>
            {(sender) => <>, {getSenderFirstName(sender())}</>}
          </Show>
        </>
      }
    >
      <Show when={firstSender()}>
        {(sender) => (
          <>
            {getSenderFirstName(sender())} and {overflow()} others
          </>
        )}
      </Show>
    </Show>
  );
}

export function InboxItemMetaRow(props: {
  item: InboxItemData;
  expandable?: boolean;
  expanded?: boolean;
  onToggleExpanded?: () => void;
}) {
  const timestamp = () => props.item.timestamp;

  return (
    <Show when={timestamp() || props.expandable}>
      <div class="flex min-w-0 items-center gap-1.5 text-xs">
        <Show when={timestamp()}>
          <span class="shrink-0 text-xs text-ink-extra-muted">
            {formatCompactRelativeTimestamp(timestamp() ?? '')}
          </span>
        </Show>
        <Show when={timestamp() && props.expandable}>
          <span class="text-ink-extra-muted" aria-hidden="true">
            •
          </span>
        </Show>
        <Show when={props.expandable}>
          <button
            type="button"
            class="text-ink-extra-muted hover:text-ink-muted focus-visible:outline-none focus-visible:ring focus-visible:ring-accent/40"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              props.onToggleExpanded?.();
            }}
          >
            {props.expanded ? 'Hide sub items' : 'Show sub items'}
          </button>
        </Show>
      </div>
    </Show>
  );
}
