import { mapMediaItems } from '@channel/Media/media-items';
import { EntityIcon } from '@core/component/EntityIcon';
import { ItemPreview } from '@core/component/ItemPreview';
import { UserIcon } from '@core/component/UserIcon';
import { MACRO_AGENT_BOT_ID } from '@core/constant/macroAgent';
import { macroIdToEmail, tryMacroId } from '@core/user';
import MacroLogo from '@icon/macro-logo.svg';
import GithubIcon from '@icon/mcp-github.svg';
import ChatTextIcon from '@phosphor-icons/core/regular/chat-text.svg?component-solid';
import { stringToItemType } from '@service-storage/client';
import type { SoupMessageAttachment } from '@service-storage/generated/schemas';
import { Avatar, cn, Layer } from '@ui';
import { createMemo, For, type JSX, Show } from 'solid-js';
import {
  type InboxItem as InboxItemData,
  type InboxRelatedDocument,
  parseInboxSenderName,
  PropertyPill,
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

function attachmentMediaItem(attachment: SoupMessageAttachment) {
  return mapMediaItems([attachment])[0];
}

export function InboxItemActionLocationThirdRowLayout(props: {
  item: InboxItemData;
  unread?: boolean;
  selected?: boolean;
  highlighted?: boolean;
  expanded?: boolean;
  onClick?: (event: MouseEvent) => void;
  onSelectRelatedDocument?: (document: InboxRelatedDocument) => void;
  onToggleExpanded?: () => void;
  nested?: boolean;
}) {
  const item = () => props.item;
  const grouped = () => !props.nested && Boolean(item().subItems?.length);
  const senderName = useInboxItemSenderName(item);
  const location = () => getLocationText(item(), props.nested);
  const action = () => getActionText(item(), props.nested);
  const content = () => getContentText(item(), grouped());
  const unreadCount = () => getGroupUnreadCount(item());
  const groupCount = () => getGroupCount(item());
  const badgeCount = () =>
    grouped() ? unreadCount() || groupCount() : undefined;
  const badgeUnread = () => unreadCount() > 0;
  const actionRowTextClass = () =>
    props.unread ? 'text-ink' : 'text-ink-extra-muted';
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
      grouped() &&
        item().notification?.notification_metadata.tag?.startsWith('channel_')
    );
  const isThreadGroup = () =>
    isChannelGroup() && isGroupedChannelThread(item());
  const groupItems = () => item().subItems ?? [item()];
  const actionRowText = () =>
    [senderName(), action(), displayLocation()].filter(Boolean).join(' ');
  const visibleAttachments = createMemo(() =>
    (item().attachments ?? []).slice(0, 4)
  );
  const overflowAttachmentCount = createMemo(() =>
    Math.max((item().attachments?.length ?? 0) - visibleAttachments().length, 0)
  );
  const interactive = () => Boolean(props.onClick);
  const onKeyDown = (event: KeyboardEvent) => {
    if (!interactive()) return;
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    props.onClick?.(event as unknown as MouseEvent);
  };
  const shouldUseGroupIcon = () =>
    grouped() &&
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
    );

  const senderDisplayName = (senderItem: InboxItemData) => {
    const macroId = tryMacroId(
      senderItem.senderId ?? senderItem.senderName ?? ''
    );
    return macroId ? macroIdToEmail(macroId) : parseInboxSenderName(senderItem);
  };
  const initials = (value: string) =>
    value
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join('') || '?';
  const senderMacroId = (senderItem: InboxItemData) => {
    if (senderItem.notification?.notification_metadata.tag === 'ai_response') {
      return MACRO_AGENT_BOT_ID;
    }
    return senderItem.senderId ? tryMacroId(senderItem.senderId) : undefined;
  };
  const renderSender = (
    senderItem: InboxItemData,
    options?: {
      showName?: boolean;
      avatarClass?: string;
      class?: string;
      style?: JSX.CSSProperties;
    }
  ) => {
    const name = () => senderDisplayName(senderItem);
    const macroId = () => senderMacroId(senderItem);
    const showName = () => options?.showName ?? true;

    return (
      <span
        class={cn(
          'min-w-0 shrink-0 inline-flex items-center',
          showName() && 'gap-1 text-xs text-ink',
          options?.class
        )}
        style={options?.style}
      >
        <span
          class={cn(
            'inline-flex size-3 shrink-0 overflow-hidden rounded-full',
            options?.avatarClass
          )}
        >
          <Show
            when={macroId()}
            fallback={
              <Show
                when={senderItem.senderId === 'macro-agent'}
                fallback={
                  <Avatar size="fill" class="text-[8px]">
                    <Avatar.Fallback>{initials(name())}</Avatar.Fallback>
                  </Avatar>
                }
              >
                <MacroLogo class="m-auto size-1/2" />
              </Show>
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
        </span>
        <Show when={showName()}>
          <span class="min-w-0 truncate">{name()}</span>
        </Show>
      </span>
    );
  };
  const renderAttachment = (attachment: SoupMessageAttachment) => {
    const mediaItem = () => attachmentMediaItem(attachment);

    return (
      <Show
        when={mediaItem()}
        fallback={
          <ItemPreview
            id={attachment.entity_id}
            type={stringToItemType(attachment.entity_type)}
          />
        }
      >
        {(media) => (
          <Show
            when={media().kind === 'image'}
            fallback={
              <video
                class="size-12 rounded-lg border border-edge object-cover"
                muted
                playsinline
                preload="metadata"
                src={media().src}
              />
            }
          >
            <img
              alt="Attachment preview"
              class="size-12 rounded-lg border border-edge object-cover"
              loading="lazy"
              src={media().thumbSrc ?? media().src}
            />
          </Show>
        )}
      </Show>
    );
  };
  const uniqueSenders = () => uniqueItemsBySender(groupItems());
  const firstSender = () => uniqueSenders()[0];
  const secondSender = () => uniqueSenders()[1];
  const senderOverflow = () => Math.max(0, uniqueSenders().length - 1);
  const senderFirstName = (senderItem: InboxItemData) =>
    getFirstName(senderDisplayName(senderItem));

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
            props.unread === false && 'opacity-70',
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
          <Show
            when={shouldUseGroupIcon()}
            fallback={renderSender(item(), {
              showName: false,
              avatarClass: 'size-10 bg-active text-xs text-ink-muted',
              class: 'relative shrink-0 self-start',
            })}
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
          <div class="flex min-w-0 flex-1 flex-col gap-0.5">
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
                  <Show when={badgeCount() || (!grouped() && item().unread)}>
                    <span class="ml-auto flex shrink-0 items-center">
                      <Show
                        when={badgeCount()}
                        fallback={
                          <span class="size-2 rounded-full bg-accent" />
                        }
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
                              {renderSender(item(), {
                                showName: false,
                                avatarClass: 'size-4 text-[8px]',
                                class: 'relative',
                              })}
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
                          {renderSender(item(), {
                            showName: false,
                            avatarClass: 'size-4 text-[8px]',
                            class: 'relative',
                          })}
                          <span class="shrink-0 font-medium text-ink/70">
                            <Show
                              when={uniqueSenders().length > 2}
                              fallback={
                                <>
                                  <Show when={firstSender()}>
                                    {(sender) => senderFirstName(sender())}
                                  </Show>
                                  <Show when={secondSender()}>
                                    {(sender) => (
                                      <>, {senderFirstName(sender())}</>
                                    )}
                                  </Show>
                                </>
                              }
                            >
                              <Show when={firstSender()}>
                                {(sender) => (
                                  <>
                                    {senderFirstName(sender())} and{' '}
                                    {senderOverflow()} others
                                  </>
                                )}
                              </Show>
                            </Show>
                          </span>
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
                <Show when={item().attachments?.length}>
                  <div class="mt-1 flex max-w-full flex-wrap items-center gap-1.5">
                    <For each={visibleAttachments()}>
                      {(attachment) => renderAttachment(attachment)}
                    </For>
                    <Show when={overflowAttachmentCount() > 0}>
                      <div class="grid size-12 place-items-center rounded-lg border border-edge bg-surface text-xs font-medium text-ink-muted">
                        +{overflowAttachmentCount()}
                      </div>
                    </Show>
                  </div>
                </Show>
                <Show when={item().timestamp || grouped()}>
                  <div class="flex min-w-0 items-center gap-1.5 text-xs text-ink-extra-muted">
                    <Show when={item().timestamp}>
                      <span class="shrink-0 text-xs text-ink-extra-muted/70">
                        {formatCompactRelativeTimestamp(item().timestamp ?? '')}
                      </span>
                    </Show>
                    <Show when={item().timestamp && grouped()}>
                      <span aria-hidden="true">•</span>
                    </Show>
                    <Show when={grouped()}>
                      <button
                        type="button"
                        class="rounded text-ink-extra-muted transition-colors hover:text-ink-muted focus-visible:outline-none focus-visible:ring focus-visible:ring-accent/40"
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
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
