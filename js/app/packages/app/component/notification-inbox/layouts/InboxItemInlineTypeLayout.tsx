import {
  EntityIcon,
  type EntityIconSelector,
} from '@core/component/EntityIcon';
import { StaticMarkdown } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import { unifiedListMarkdownTheme } from '@core/component/LexicalMarkdown/theme';
import { UserIcon } from '@core/component/UserIcon';
import { MACRO_AGENT_BOT_ID } from '@core/constant/macroAgent';
import MacroLogo from '@icon/macro-logo.svg';
import GithubIcon from '@icon/mcp-github.svg';
import AtIcon from '@phosphor-icons/core/regular/at.svg?component-solid';
import BellIcon from '@phosphor-icons/core/regular/bell.svg?component-solid';
import ChatIcon from '@phosphor-icons/core/regular/chat.svg?component-solid';
import EnvelopeIcon from '@phosphor-icons/core/regular/envelope.svg?component-solid';
import GitMergeIcon from '@phosphor-icons/core/regular/git-merge.svg?component-solid';
import GitPullRequestIcon from '@phosphor-icons/core/regular/git-pull-request.svg?component-solid';
import PhoneIcon from '@phosphor-icons/core/regular/phone.svg?component-solid';
import UsersIcon from '@phosphor-icons/core/regular/users.svg?component-solid';
import { Avatar, Layer } from '@ui';
import { For, Match, Show, Switch } from 'solid-js';
import { match } from 'ts-pattern';
import { InboxItem, PropertyPill, useInboxItem } from '../InboxItem';

function useNotificationType() {
  const { item } = useInboxItem();

  return () => item().notification?.notification_metadata.tag;
}

function NotificationBadge() {
  const type = useNotificationType();
  const className = 'size-3 text-ink-muted';

  const icon = () =>
    match(type())
      .with(
        'channel_mention',
        'document_mention',
        'mentioned_in_document_comment',
        'github_pr_mention',
        () => <AtIcon class={className} />
      )
      .with(
        'channel_message_send',
        'channel_message_reply',
        'replied_to_document_comment_thread',
        'commented_on_document',
        'github_pr_comment',
        () => <ChatIcon class={className} />
      )
      .with('github_pr_status_changed', () => (
        <GithubIcon class="size-3 shrink-0 text-ink-muted/60" />
      ))
      .otherwise(() => undefined);

  return (
    <Show when={icon()}>
      {(icon) => (
        <span class="absolute -right-1 -bottom-1 grid size-4 place-items-center rounded-full bg-active ring ring-surface">
          {icon()}
        </span>
      )}
    </Show>
  );
}

function ActorIcon() {
  const { item } = useInboxItem();
  const type = useNotificationType();
  const senderId = () =>
    type() === 'ai_response' ? MACRO_AGENT_BOT_ID : item().senderId;
  const fallback = () => item().senderName || item().entityName || '?';
  const initials = () =>
    fallback()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part: string) => part[0]?.toUpperCase())
      .join('') || '?';

  return (
    <InboxItem.Icon class="size-8">
      <span class="relative size-8">
        <Show
          when={type() === 'ai_response'}
          fallback={
            <Show
              when={senderId()}
              fallback={
                <Avatar size="fill" class="text-xs">
                  <Avatar.Fallback>{initials()}</Avatar.Fallback>
                </Avatar>
              }
            >
              {(id) => (
                <UserIcon
                  id={id()}
                  size="fill"
                  suppressClick
                  showTooltip={false}
                />
              )}
            </Show>
          }
        >
          <Avatar
            size="fill"
            class="bg-surface text-accent ring-1 ring-edge-muted"
          >
            <Avatar.Fallback>
              <MacroLogo class="size-[70%]" />
            </Avatar.Fallback>
          </Avatar>
        </Show>
        <NotificationBadge />
      </span>
    </InboxItem.Icon>
  );
}

function GithubStatusIcon(props: { class?: string } = {}) {
  const { item } = useInboxItem();
  const status = () => {
    const metadata = item().notification?.notification_metadata;
    if (metadata?.tag !== 'github_pr_status_changed') return undefined;
    return metadata.content.status;
  };
  const iconClass = () => props.class ?? 'size-4';

  return (
    <Switch
      fallback={<GitPullRequestIcon class={`${iconClass()} text-success`} />}
    >
      <Match when={status() === 'closed'}>
        <GitPullRequestIcon class={`${iconClass()} text-failure`} />
      </Match>
      <Match when={status() === 'merged'}>
        <GitMergeIcon class={`${iconClass()} text-note`} />
      </Match>
    </Switch>
  );
}

function fallbackEntityIconType(
  type: string | undefined
): EntityIconSelector | undefined {
  if (type === 'channel_message') return 'channel';
  if (type === 'document') return 'md';
  if (type === 'crm_contact' || type === 'foreign') return undefined;
  return type as EntityIconSelector | undefined;
}

function EntityTypeIcon() {
  const { item } = useInboxItem();
  const type = useNotificationType();

  return match(type())
    .with('new_email', () => (
      <EnvelopeIcon class="size-3.5 shrink-0 text-ink-muted" />
    ))
    .with(
      'channel_mention',
      'channel_message_send',
      'channel_message_reply',
      'channel_invite',
      () => (
        <span class="size-3.5 shrink-0">
          <EntityIcon targetType="channel" size="fill" />
        </span>
      )
    )
    .with(
      'document_mention',
      'mentioned_in_document_comment',
      'replied_to_document_comment_thread',
      'commented_on_document',
      () => <EntityIcon targetType="md" class="size-3.5 shrink-0" />
    )
    .with('task_assigned', () => (
      <span class="size-3.5 shrink-0">
        <EntityIcon targetType="task" size="fill" />
      </span>
    ))
    .with('ai_response', () => undefined)
    .with('invite_to_team', () => (
      <UsersIcon class="size-3.5 shrink-0 text-ink-muted" />
    ))
    .with('github_pr_status_changed', () => (
      <GithubStatusIcon class="size-3.5 shrink-0" />
    ))
    .with(
      'github_review_requested',
      'github_pr_comment',
      'github_pr_mention',
      'github_pr_review',
      () => <GithubIcon class="size-3.5 shrink-0 text-ink-muted/60" />
    )
    .with('call-started', () => (
      <PhoneIcon class="size-3.5 shrink-0 text-ink-muted" />
    ))
    .otherwise(() =>
      fallbackEntityIconType(item().entityType) ? (
        <EntityIcon
          targetType={fallbackEntityIconType(item().entityType)}
          class="size-3.5 shrink-0"
        />
      ) : (
        <BellIcon class="size-3.5 shrink-0 text-ink-muted" />
      )
    );
}

function titleContext() {
  const { item } = useInboxItem();
  const metadata = () => item().notification?.notification_metadata;

  return (): string | undefined => {
    const current = metadata();
    if (!current) return undefined;

    return match(current)
      .with(
        { tag: 'channel_mention' },
        { tag: 'channel_message_send' },
        { tag: 'channel_message_reply' },
        (metadata) => String(metadata.content.channelName || '') || undefined
      )
      .with(
        { tag: 'channel_invite' },
        (metadata) => String(metadata.content.channelName || '') || undefined
      )
      .with(
        { tag: 'invite_to_team' },
        (metadata) => String(metadata.content.teamName || '') || undefined
      )
      .with(
        { tag: 'document_mention' },
        { tag: 'mentioned_in_document_comment' },
        { tag: 'replied_to_document_comment_thread' },
        { tag: 'commented_on_document' },
        (metadata) => String(metadata.content.documentName || '') || undefined
      )
      .with(
        { tag: 'github_pr_status_changed' },
        { tag: 'github_review_requested' },
        { tag: 'github_pr_comment' },
        { tag: 'github_pr_mention' },
        { tag: 'github_pr_review' },
        (metadata) =>
          `${String(metadata.content.owner)}/${String(metadata.content.repo)}#${String(metadata.content.number)}`
      )
      .otherwise(() => undefined);
  };
}

function itemTitle() {
  const { item } = useInboxItem();
  const context = titleContext();

  return () =>
    item().targetName || item().entityName || context() || 'Notification';
}

function emailSubject() {
  const { item } = useInboxItem();

  return () => {
    const metadata = item().notification?.notification_metadata;
    if (metadata?.tag !== 'new_email') return undefined;
    return String(metadata.content.subject || '') || undefined;
  };
}

function TitleRow() {
  const { item } = useInboxItem();
  const type = useNotificationType();
  const title = itemTitle();
  const subject = emailSubject();
  const displayTitle = () => {
    if (type() === 'new_email') return subject() || title();
    if (type() === 'ai_response') return item().senderName || 'Macro agent';
    return title();
  };

  return (
    <div class="flex min-w-0 items-center gap-1 text-sm text-ink-muted">
      <EntityTypeIcon />
      <span class="min-w-0 truncate">{displayTitle()}</span>
    </div>
  );
}

function actionText() {
  const { item } = useInboxItem();
  const type = useNotificationType();

  return () => {
    if (type() === 'ai_response') return undefined;
    if (type() === 'github_pr_comment') return undefined;
    if (type() === 'github_pr_mention') return undefined;
    return item().action;
  };
}

function shouldRenderMarkdownContent(
  type: ReturnType<typeof useNotificationType>
) {
  return () =>
    type() === 'channel_mention' ||
    type() === 'channel_message_send' ||
    type() === 'channel_message_reply' ||
    type() === 'mentioned_in_document_comment' ||
    type() === 'replied_to_document_comment_thread' ||
    type() === 'commented_on_document' ||
    type() === 'github_pr_comment' ||
    type() === 'github_pr_mention' ||
    type() === 'github_pr_review';
}

function ContentText(props: { content: string }) {
  const type = useNotificationType();
  const markdown = shouldRenderMarkdownContent(type);

  return (
    <span class="block min-w-0 overflow-hidden truncate">
      <Show when={markdown()} fallback={props.content}>
        <StaticMarkdown
          markdown={props.content}
          singleLine
          theme={unifiedListMarkdownTheme}
        />
      </Show>
    </span>
  );
}

function Description() {
  const { item } = useInboxItem();
  const type = useNotificationType();

  const unreadSubItems = () =>
    item().subItems?.filter((subItem) => subItem.unread) ?? [];
  const unreadGroupCount = () =>
    (item().unread ? 1 : 0) + unreadSubItems().length;
  const groupLabel = unreadGroupLabel(type);
  const groupedDescription = () =>
    unreadSubItems()[0]?.content || item().content;
  const unreadGroupDescription = () => {
    if (!item().subItems?.length || unreadGroupCount() === 0) return undefined;
    return `${unreadGroupCount()} new ${groupLabel()}`;
  };
  const description = () => unreadGroupDescription() || groupedDescription();

  return (
    <Show when={description()}>
      {(content) => (
        <div class="min-w-0 truncate text-sm text-ink-muted/75">
          <ContentText content={content()} />
        </div>
      )}
    </Show>
  );
}

function unreadGroupLabel(type: ReturnType<typeof useNotificationType>) {
  return () =>
    match(type())
      .with('new_email', () => 'emails')
      .with(
        'channel_mention',
        'channel_message_send',
        'channel_message_reply',
        () => 'messages'
      )
      .with(
        'document_mention',
        'mentioned_in_document_comment',
        'replied_to_document_comment_thread',
        'commented_on_document',
        () => 'comments'
      )
      .with('task_assigned', () => 'tasks')
      .with(
        'github_pr_status_changed',
        'github_review_requested',
        'github_pr_comment',
        'github_pr_mention',
        'github_pr_review',
        () => 'GitHub updates'
      )
      .otherwise(() => 'notifications');
}

function ActionRow() {
  const { item } = useInboxItem();
  const action = actionText();

  return (
    <div class="flex min-w-0 items-center gap-1 text-xs text-ink-extra-muted/70">
      <Show
        when={item().senderName || item().senderId}
        fallback={
          <Show
            when={
              item().notification?.notification_metadata.tag === 'ai_response'
            }
          >
            Macro agent
          </Show>
        }
      >
        <InboxItem.Sender
          avatar={false}
          class="min-w-0 shrink-0 truncate text-xs text-ink-extra-muted/70"
        />
      </Show>
      <Show when={action()}>
        {(action) => <span class="min-w-0 truncate">{action()}</span>}
      </Show>
      <For each={item().properties ?? []}>
        {(property) => <PropertyPill property={property} />}
      </For>
    </div>
  );
}

function TimestampColumn() {
  const { item } = useInboxItem();
  const groupCount = () => {
    const count = (item().subItems?.length ?? 0) + 1;
    return count > 1 ? count : undefined;
  };

  return (
    <div class="flex h-full flex-col items-end justify-between pt-0.5">
      <Show when={item().timestamp}>
        {(timestamp) => (
          <InboxItem.Timestamp>{timestamp()}</InboxItem.Timestamp>
        )}
      </Show>
      <Show when={groupCount()}>
        {(count) => (
          <Layer depth={5}>
            <span class="grid h-4 min-w-4 place-items-center rounded bg-ink-muted/10 px-1 text-xs text-ink-muted">
              {count()}
            </span>
          </Layer>
        )}
      </Show>
    </div>
  );
}

export function InboxItemInlineTypeLayout(
  props: { onClick?: (event: MouseEvent) => void } = {}
) {
  return (
    <InboxItem.Content class="min-h-16" onClick={props.onClick}>
      <InboxItem.Leading>
        <InboxItem.UnreadIndicator />
      </InboxItem.Leading>
      <ActorIcon />
      <InboxItem.Body>
        <div class="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-x-2">
          <div class="flex min-w-0 flex-col gap-1">
            <ActionRow />
            <div class="flex min-w-0 flex-col">
              <TitleRow />
              <Description />
            </div>
          </div>
          <TimestampColumn />
        </div>
      </InboxItem.Body>
    </InboxItem.Content>
  );
}
