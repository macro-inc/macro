import {
  EntityIcon,
  type EntityIconSelector,
} from '@core/component/EntityIcon';
import { StaticMarkdown } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import { unifiedListMarkdownTheme } from '@core/component/LexicalMarkdown/theme';
import { UserIcon } from '@core/component/UserIcon';
import { MACRO_AGENT_BOT_ID } from '@core/constant/macroAgent';
import { macroIdToEmail, tryMacroId, useDisplayName } from '@core/user';
import MacroLogo from '@icon/macro-logo.svg';
import GithubIcon from '@icon/mcp-github.svg';
import ChatTextIcon from '@phosphor-icons/core/regular/chat-text.svg?component-solid';
import { Avatar, cn, Layer } from '@ui';
import {
  differenceInDays,
  differenceInHours,
  differenceInMilliseconds,
  differenceInMonths,
  differenceInWeeks,
  differenceInYears,
  format,
} from 'date-fns';
import { For, Show } from 'solid-js';
import {
  InboxItem,
  type InboxItem as InboxItemData,
  type InboxRelatedDocument,
  PropertyPill,
  useInboxItem,
} from '../InboxItem';

function notificationTag() {
  const { item } = useInboxItem();
  return () => item().notification?.notification_metadata.tag;
}

function parsedSenderName(item: InboxItemData) {
  const name = item.senderName || item.senderId || '?';
  const emailMatch = name.match(/^"?([^"<]+)"?\s*</);
  if (emailMatch?.[1]) return emailMatch[1].trim();
  const parsedMacroId = tryMacroId(name);
  if (parsedMacroId) return macroIdToEmail(parsedMacroId);
  return name;
}

function useSenderName() {
  const { item } = useInboxItem();
  const macroId = () => {
    const sender = item().senderId ?? item().senderName;
    return sender ? tryMacroId(sender) : undefined;
  };
  const fallback = () => parsedSenderName(item());
  const [displayName] = useDisplayName(macroId());
  return () =>
    displayName() || (macroId() ? macroIdToEmail(macroId()!) : fallback());
}

function isThreadGroupItem(item: InboxItemData) {
  const content = item.notification?.notification_metadata.content as
    | { threadId?: string | null }
    | undefined;
  return Boolean(
    item.subItems?.length &&
      item.notification?.notification_metadata.tag?.startsWith('channel_') &&
      content?.threadId
  );
}

function groupIconTarget(
  item: ReturnType<typeof useInboxItem>['item']
): EntityIconSelector {
  const value = item();
  if (value.entitySubType === 'task') return 'task';
  if (
    value.entityType === 'channel_message' ||
    value.entityType === 'channel_thread'
  )
    return 'channel';
  if (value.entityType === 'document') return 'md';
  if (value.entityType === 'foreign') return 'default';
  return value.entityType as EntityIconSelector;
}

function ActorIcon(props: { groupRoot?: boolean }) {
  const { item } = useInboxItem();
  const name = useSenderName();
  const macroId = () => {
    const senderId = item().senderId;
    return senderId ? tryMacroId(senderId) : undefined;
  };
  const initials = () =>
    name()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join('') || '?';

  return (
    <Show
      when={
        props.groupRoot &&
        item().channelType !== 'direct_message' &&
        item().entityType !== 'email' &&
        item().notification?.notification_metadata.tag !== 'new_email' &&
        !(
          item().entitySubType === 'task' &&
          (item().notification?.notification_metadata.tag ===
            'mentioned_in_document_comment' ||
            item().notification?.notification_metadata.tag ===
              'replied_to_document_comment_thread' ||
            item().notification?.notification_metadata.tag ===
              'commented_on_document')
        )
      }
      fallback={
        <div class="relative size-10 shrink-0 self-start">
          <div class="grid size-full place-items-center overflow-hidden rounded-full bg-active text-xs text-ink-muted">
            <Show
              when={
                item().notification?.notification_metadata.tag === 'ai_response'
              }
              fallback={
                <Show
                  when={item().senderId && macroId()}
                  fallback={
                    <Show
                      when={item().senderId === 'macro-agent'}
                      fallback={
                        <Avatar size="fill">
                          <Avatar.Fallback>{initials()}</Avatar.Fallback>
                        </Avatar>
                      }
                    >
                      <MacroLogo class="size-5" />
                    </Show>
                  }
                >
                  {(senderId) => (
                    <UserIcon
                      id={senderId()}
                      size="fill"
                      suppressClick
                      showTooltip={false}
                    />
                  )}
                </Show>
              }
            >
              <UserIcon
                id={MACRO_AGENT_BOT_ID}
                size="fill"
                suppressClick
                showTooltip={false}
              />
            </Show>
          </div>
        </div>
      }
    >
      <span class="self-start">
        <Layer depth={3}>
          <div class="grid size-10 shrink-0 place-items-center rounded-full bg-gradient-to-br from-active to-active-hover p-2.5 text-ink-extra-muted">
            <Show
              when={isThreadGroupItem(item())}
              fallback={
                <Show
                  when={item().notification?.notification_metadata.tag?.startsWith(
                    'github_'
                  )}
                  fallback={
                    <EntityIcon
                      targetType={groupIconTarget(item)}
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
    </Show>
  );
}

function githubLocation() {
  const { item } = useInboxItem();
  return () => {
    const content = item().notification?.notification_metadata.content as
      | { owner?: string; repo?: string; number?: number }
      | undefined;
    if (!content?.owner || !content.repo || content.number == null) {
      return undefined;
    }
    return `${content.owner}/${content.repo}#${content.number}`;
  };
}

function githubTitle() {
  const { item } = useInboxItem();
  return () => {
    const content = item().notification?.notification_metadata.content as
      | { title?: string }
      | undefined;
    return content?.title;
  };
}

function isDirectMessageChannel() {
  const { item } = useInboxItem();
  return () => item().channelType === 'direct_message';
}

function locationText(nested?: boolean) {
  const { item } = useInboxItem();
  const github = githubLocation();
  const isDirectMessage = isDirectMessageChannel();

  if (nested || isDirectMessage() || notificationTag()() === 'task_assigned') {
    return undefined;
  }
  if (item().entityType === 'email' || notificationTag()() === 'new_email') {
    return undefined;
  }
  if (item().entityType === 'channel')
    return item().targetName ?? item().entityName;
  if (item().notification?.notification_metadata.tag?.startsWith('github_')) {
    return github() ?? item().targetName ?? item().entityName;
  }

  return item().targetName ?? item().entityName;
}

function actionText(nested?: boolean) {
  const tag = notificationTag();
  const { item } = useInboxItem();
  switch (tag()) {
    case 'channel_mention':
      return nested ? 'mentioned you' : 'mentioned you in';
    case 'channel_message_reply':
      return 'replied';
    case 'channel_message_send':
      return 'sent a message';
    case 'document_mention':
      return 'shared';
    case 'mentioned_in_document_comment':
      return nested ? 'mentioned you' : 'mentioned you in';
    case 'replied_to_document_comment_thread':
      return nested ? 'replied' : 'replied in';
    case 'new_email':
      return 'sent an email';
    case 'task_assigned':
      return 'assigned you a task';
    case 'ai_response':
      return 'responded';
    case 'github_pr_status_changed': {
      const content = item().notification?.notification_metadata.content as
        | { status?: string }
        | undefined;
      return content?.status === 'merged'
        ? 'merged a PR'
        : (item().action ?? 'updated');
    }
    default:
      return item().action ?? 'updated';
  }
}

function emailSubject() {
  const { item } = useInboxItem();
  return () => {
    const content = item().notification?.notification_metadata.content as
      | { subject?: string }
      | undefined;
    return content?.subject;
  };
}

function groupCount() {
  const { item } = useInboxItem();
  return () => (item().subItems?.length ?? 0) + 1;
}

function groupUnreadCount() {
  const { item } = useInboxItem();
  return () =>
    (item().unread ? 1 : 0) +
    (item().subItems?.filter((sub) => sub.unread).length ?? 0);
}

function contentText(groupRoot?: boolean) {
  const { item } = useInboxItem();
  const subject = emailSubject();
  const prTitle = githubTitle();
  if (groupRoot) {
    return item().content || item().entityName || item().targetName;
  }
  if (item().notification?.notification_metadata.tag === 'new_email') {
    return (
      subject() || item().entityName || item().targetName || item().content
    );
  }
  if (item().notification?.notification_metadata.tag === 'document_mention') {
    return item().entityName || item().targetName || item().content;
  }
  if (item().notification?.notification_metadata.tag === 'task_assigned') {
    return item().entityName || item().targetName || item().content;
  }
  if (item().notification?.notification_metadata.tag?.startsWith('github_')) {
    return (
      prTitle() || item().entityName || item().targetName || item().content
    );
  }

  if (
    item().entityType === 'channel' ||
    item().entityType === 'channel_thread'
  ) {
    return;
  }

  return item().content || item().entityName || item().targetName || undefined;
}

function formatRelativeInboxTimestamp(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  const now = new Date();
  const ageMs = differenceInMilliseconds(now, date);
  if (ageMs < 12 * 60 * 60 * 1000) return format(date, 'p');

  const hours = differenceInHours(now, date);
  if (hours < 24) return `${Math.max(12, hours)}h`;

  const days = differenceInDays(now, date);
  if (days < 7) return `${Math.max(1, days)}d`;

  const weeks = differenceInWeeks(now, date);
  if (weeks < 5) return `${Math.max(1, weeks)}w`;

  const months = differenceInMonths(now, date);
  if (months < 12) return `${Math.max(1, months)}m`;

  return `${Math.max(1, differenceInYears(now, date))}y`;
}

function MiniSenderAvatar(props: { item: InboxItemData; index?: number }) {
  const fallbackName = () => parsedSenderName(props.item);
  const macroId = () => {
    const sender = props.item.senderId ?? props.item.senderName;
    return sender ? tryMacroId(sender) : undefined;
  };
  const [displayName] = useDisplayName(macroId());
  const name = () =>
    displayName() || (macroId() ? macroIdToEmail(macroId()!) : fallbackName());
  const initials = () =>
    name()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join('') || '?';

  return (
    <span
      class="relative inline-flex size-4 shrink-0 overflow-hidden rounded-full text-[8px]"
      style={{ 'z-index': String(10 - (props.index ?? 0)) }}
    >
      <Show
        when={props.item.senderId && macroId()}
        fallback={
          <Avatar size="fill">
            <Avatar.Fallback>{initials()}</Avatar.Fallback>
          </Avatar>
        }
      >
        {(senderId) => (
          <UserIcon
            id={senderId()}
            size="fill"
            suppressClick
            showTooltip={false}
          />
        )}
      </Show>
    </span>
  );
}

function uniqueSenderItems(items: InboxItemData[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = item.senderId ?? parsedSenderName(item) ?? item.id;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function firstNameFromName(value: string) {
  const name = value.includes('@') ? value.split('@')[0] : value;
  return name.split(/[\s._-]+/).filter(Boolean)[0] ?? name;
}

function SenderFirstName(props: { item: InboxItemData }) {
  const macroId = () => {
    const sender = props.item.senderId ?? props.item.senderName;
    return sender ? tryMacroId(sender) : undefined;
  };
  const [displayName] = useDisplayName(macroId());
  const name = () =>
    displayName() ||
    (macroId() ? macroIdToEmail(macroId()!) : parsedSenderName(props.item));

  return <>{firstNameFromName(name())}</>;
}

function SenderNamesSummary(props: { items: InboxItemData[] }) {
  const senders = () => uniqueSenderItems(props.items);
  const first = () => senders()[0];
  const second = () => senders()[1];
  const overflow = () => Math.max(0, senders().length - 1);

  return (
    <span class="shrink-0 font-medium text-ink/70">
      <Show
        when={senders().length > 2}
        fallback={
          <>
            <Show when={first()}>
              {(item) => <SenderFirstName item={item()} />}
            </Show>
            <Show when={second()}>
              {(item) => (
                <>
                  {', '}
                  <SenderFirstName item={item()} />
                </>
              )}
            </Show>
          </>
        }
      >
        <Show when={first()}>
          {(item) => (
            <>
              <SenderFirstName item={item()} /> and {overflow()} others
            </>
          )}
        </Show>
      </Show>
    </span>
  );
}

function MarkdownLine(props: { content: string }) {
  return (
    <span class="inline min-w-0">
      <StaticMarkdown
        markdown={props.content}
        singleLine
        theme={unifiedListMarkdownTheme}
      />
    </span>
  );
}

function RowLayout(props: {
  onClick?: (event: MouseEvent) => void;
  groupRoot?: boolean;
  nested?: boolean;
  onToggleExpanded?: () => void;
}) {
  const { item, unread, selected, expanded } = useInboxItem();
  const location = () => locationText(props.nested);
  const action = () => actionText(props.nested);
  const content = () => contentText(props.groupRoot);
  const senderName = useSenderName();
  const count = groupCount();
  const unreadCount = groupUnreadCount();
  const badgeCount = () => {
    if (props.groupRoot) return unreadCount() || count();
    return undefined;
  };
  const badgeUnread = () => unreadCount() > 0;
  const actionRowTextClass = () =>
    unread() ? 'text-ink' : 'text-ink-extra-muted';
  const secondaryTextClass = () => 'text-ink/60';
  const displayLocation = () => {
    const value = location();
    if (!value) return undefined;
    if (
      item().entityType === 'channel' ||
      item().entityType === 'channel_message' ||
      item().entityType === 'channel_thread'
    ) {
      return value.startsWith('#') ? value : `#${value}`;
    }
    return value;
  };
  const isChannelGroup = () =>
    Boolean(
      props.groupRoot &&
        item().notification?.notification_metadata.tag?.startsWith('channel_')
    );
  const isThreadGroup = () => isChannelGroup() && isThreadGroupItem(item());
  const groupItems = () => item().subItems ?? [item()];
  const actionRowText = () =>
    [senderName(), action(), displayLocation()].filter(Boolean).join(' ');

  return (
    <div class="col-span-3 grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2">
      <InboxItem.Content
        class={cn(
          'relative col-span-1 min-h-16 grid-cols-[var(--inbox-item-icon-size)_minmax(0,1fr)] items-center gap-x-3 transition-opacity !ring-0 hover:opacity-100 hover:!ring-0 [--inbox-item-icon-size:2.5rem]',
          !unread() && 'opacity-75',
          selected() && 'bg-active/50 opacity-100'
        )}
        onClick={props.onClick}
      >
        <ActorIcon groupRoot={props.groupRoot} />
        <InboxItem.Body>
          <div class="flex min-w-0 flex-col gap-1.5">
            <div class="flex min-w-0 flex-col gap-0.5">
              <div
                class={cn(
                  'flex min-w-0 items-center gap-1 text-sm',
                  actionRowTextClass()
                )}
              >
                <Show
                  when={isChannelGroup()}
                  fallback={
                    <>
                      <Show
                        when={item().notification?.notification_metadata.tag?.startsWith(
                          'github_'
                        )}
                      >
                        <GithubIcon class="size-3.5 shrink-0 text-ink-muted" />
                      </Show>
                      <span class="min-w-0 flex-1 truncate">
                        {actionRowText()}
                      </span>
                    </>
                  }
                >
                  <Show
                    when={
                      displayLocation() ??
                      item().targetName ??
                      item().entityName
                    }
                  >
                    {(content) => (
                      <span class="min-w-0 flex-1 truncate font-medium">
                        {content()}
                      </span>
                    )}
                  </Show>
                </Show>
                <Show
                  when={badgeCount() || (!props.groupRoot && item().unread)}
                >
                  <span class="ml-auto flex shrink-0 items-center">
                    <Show
                      when={badgeCount()}
                      fallback={<span class="size-2 rounded-full bg-accent" />}
                    >
                      {(count) => (
                        <span
                          class={cn(
                            'grid h-4 min-w-4 place-items-center rounded px-1 text-xs',
                            badgeUnread()
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
              </div>
              <div class="flex min-w-0 items-center gap-2">
                <Show when={content()}>
                  {(value) => (
                    <Show
                      when={isThreadGroup()}
                      fallback={
                        <p
                          class={cn(
                            'min-w-0 truncate text-sm',
                            item().notification?.notification_metadata.tag !==
                              'task_assigned' && 'flex-1',
                            secondaryTextClass()
                          )}
                        >
                          <Show when={isChannelGroup()}>
                            <MiniSenderAvatar item={item()} />
                            <span class="font-medium text-ink/70">
                              {senderName()}:{' '}
                            </span>
                          </Show>
                          <MarkdownLine content={value()} />
                        </p>
                      }
                    >
                      <div
                        class={cn(
                          'flex min-w-0 flex-1 items-center gap-1 text-sm',
                          secondaryTextClass()
                        )}
                      >
                        <MiniSenderAvatar item={item()} />
                        <SenderNamesSummary items={groupItems()} />
                        <span class="shrink-0">replied:</span>
                        <span class="min-w-0 truncate">
                          <MarkdownLine content={value()} />
                        </span>
                      </div>
                    </Show>
                  )}
                </Show>
                <Show
                  when={
                    item().notification?.notification_metadata.tag ===
                      'task_assigned' && item().properties?.length
                  }
                >
                  <span class="flex shrink-0 items-center gap-1">
                    <For each={item().properties}>
                      {(property) => <PropertyPill property={property} />}
                    </For>
                  </span>
                </Show>
              </div>
              <InboxItem.AttachmentPreviews
                attachments={item().attachments}
                class="mt-1"
              />
              <Show when={item().timestamp || props.groupRoot}>
                <div class="flex min-w-0 items-center gap-1.5 text-xs text-ink-extra-muted">
                  <Show when={item().timestamp}>
                    <InboxItem.Timestamp>
                      {formatRelativeInboxTimestamp(item().timestamp ?? '')}
                    </InboxItem.Timestamp>
                  </Show>
                  <Show when={item().timestamp && props.groupRoot}>
                    <span aria-hidden="true">•</span>
                  </Show>
                  <Show when={props.groupRoot}>
                    <button
                      type="button"
                      class="rounded text-ink-extra-muted transition-colors hover:text-ink-muted focus-visible:outline-none focus-visible:ring focus-visible:ring-accent/40"
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        props.onToggleExpanded?.();
                      }}
                    >
                      {expanded() ? 'Hide sub items' : 'Show sub items'}
                    </button>
                  </Show>
                </div>
              </Show>
            </div>
          </div>
        </InboxItem.Body>
      </InboxItem.Content>
    </div>
  );
}

export function InboxItemActionLocationThirdRowLayout(props: {
  onClick?: (event: MouseEvent) => void;
  onSelectRelatedDocument?: (document: InboxRelatedDocument) => void;
  onToggleExpanded?: () => void;
  nested?: boolean;
}) {
  const { item } = useInboxItem();
  const grouped = () => !props.nested && Boolean(item().subItems?.length);

  return (
    <RowLayout
      groupRoot={grouped()}
      nested={props.nested}
      onClick={props.onClick}
      onToggleExpanded={props.onToggleExpanded}
    />
  );
}
