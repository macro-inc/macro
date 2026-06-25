import { EntityIcon } from '@core/component/EntityIcon';
import { macroIdToEmail, tryMacroId, useDisplayName } from '@core/user';
import GithubIcon from '@icon/mcp-github.svg';
import ChatTextIcon from '@phosphor-icons/core/regular/chat-text.svg?component-solid';
import { cn, Layer } from '@ui';
import { For, Show } from 'solid-js';
import {
  InboxItem,
  type InboxItem as InboxItemData,
  type InboxRelatedDocument,
  parseInboxSenderName,
  PropertyPill,
  useInboxItem,
  useInboxItemSenderName,
} from '../InboxItem';
import {
  getActionText,
  getContentText,
  getFirstName,
  formatCompactRelativeTimestamp,
  getGroupCount,
  getInboxItemIconTarget,
  getGroupUnreadCount,
  isGroupedChannelThread,
  getLocationText,
  uniqueItemsBySender,
} from './InboxItemActionLocationThirdRowLayout.utils';

function useSenderName() {
  return useInboxItemSenderName();
}

function ActorIcon(props: { groupRoot?: boolean }) {
  const { item } = useInboxItem();
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
        <InboxItem.Sender
          showName={false}
          avatarClass="size-10 bg-active text-xs text-ink-muted"
          class="relative shrink-0 self-start"
        />
      }
    >
      <span class="self-start">
        <Layer depth={3}>
          <div class="grid size-10 shrink-0 place-items-center rounded-full bg-gradient-to-br from-active to-active-hover p-2.5 text-ink-extra-muted">
            <Show
              when={isGroupedChannelThread(item())}
              fallback={
                <Show
                  when={item().notification?.notification_metadata.tag?.startsWith(
                    'github_'
                  )}
                  fallback={
                    <EntityIcon
                      targetType={getInboxItemIconTarget(item())}
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

function MiniSenderAvatar(props: { item: InboxItemData; index?: number }) {
  return (
    <InboxItem.Sender
      item={props.item}
      showName={false}
      avatarClass="size-4 text-[8px]"
      class="relative"
      style={{ 'z-index': String(10 - (props.index ?? 0)) }}
    />
  );
}

function SenderFirstName(props: { item: InboxItemData }) {
  const macroId = () => {
    const sender = props.item.senderId ?? props.item.senderName;
    return sender ? tryMacroId(sender) : undefined;
  };
  const [displayName] = useDisplayName(macroId());
  const name = () =>
    displayName() ||
    (macroId() ? macroIdToEmail(macroId()!) : parseInboxSenderName(props.item));

  return <>{getFirstName(name())}</>;
}

function SenderNamesSummary(props: { items: InboxItemData[] }) {
  const senders = () => uniqueItemsBySender(props.items);
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

function RowLayout(props: {
  onClick?: (event: MouseEvent) => void;
  groupRoot?: boolean;
  nested?: boolean;
  onToggleExpanded?: () => void;
}) {
  const { item, unread, selected, expanded } = useInboxItem();
  const location = () => getLocationText(item(), props.nested);
  const action = () => getActionText(item(), props.nested);
  const content = () => getContentText(item(), props.groupRoot);
  const senderName = useSenderName();
  const count = () => getGroupCount(item());
  const unreadCount = () => getGroupUnreadCount(item());
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
  const isThreadGroup = () =>
    isChannelGroup() && isGroupedChannelThread(item());
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
                          <span class="inline min-w-0">{value()}</span>
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
                          <span class="inline min-w-0">{value()}</span>
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
                      {formatCompactRelativeTimestamp(item().timestamp ?? '')}
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
