import { ListPropertyValue } from '@app/component/next-soup/soup-view/views/tasks/list-property-value';
import { mapMediaItems } from '@channel/Media/media-items';
import { BotIcon } from '@channel/Message/BotIcon';
import { MACRO_AI_BOT_ID, MACRO_AI_NAME } from '@channel/macroAi';
import { EntityIcon, getEntityIconType } from '@core/component/EntityIcon';
import { ItemPreview } from '@core/component/ItemPreview';
import { StaticMarkdown } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import { unifiedListMarkdownTheme } from '@core/component/LexicalMarkdown/theme';
import { UserIcon } from '@core/component/UserIcon';
import { isMacroAgentId } from '@core/constant/macroAgent';
import { tryMacroId, useDisplayName } from '@core/user';
import {
  type EntityData,
  isGithubPrEntity,
  type Notification,
  type WithNotification,
} from '@entity';
import MacroLogo from '@icon/macro-logo.svg';
import GithubIcon from '@icon/mcp-github.svg';
import FilesIcon from '@phosphor/files.svg';
import ArrowBendUpLeftIcon from '@phosphor-icons/core/regular/arrow-bend-up-left.svg?component-solid';
import AtIcon from '@phosphor-icons/core/regular/at.svg?component-solid';
import ChatCircleIcon from '@phosphor-icons/core/regular/chat-circle.svg?component-solid';
import ChatTextIcon from '@phosphor-icons/core/regular/chat-text.svg?component-solid';
import PhoneIcon from '@phosphor-icons/core/regular/phone.svg?component-solid';
import UserPlusIcon from '@phosphor-icons/core/regular/user-plus.svg?component-solid';
import {
  PropertiesProvider,
  type PropertySaveHandler,
} from '@property/context/PropertiesContext';
import type { PropertyApiValues, Property as PropertyT } from '@property/types';
import { senderFromStorageId } from '@queries/channel/message-sender';
import { useBulkSaveEntityPropertiesMutation } from '@queries/properties/entity';
import { stringToItemType } from '@service-storage/client';
import { EntityType } from '@service-storage/generated/schemas';
import { cn } from '@ui';
import {
  createMemo,
  createSignal,
  For,
  type JSX,
  Match,
  Show,
  Switch,
} from 'solid-js';
import { match, P } from 'ts-pattern';
import { InboxCard, type InboxCardAttachment } from './InboxCard';
import {
  formatCompactRelativeTimestamp,
  getGithubTitle,
  getInboxTaskProperties,
  getNotificationTag,
  itemContent,
} from './utils';

export interface InboxCardLayoutProps {
  /** The already-derived item to render. */
  item: InboxCardDisplayItem;
  selected?: boolean;
  highlighted?: boolean;
  expanded?: boolean;
  onClick?: (event: MouseEvent) => void;
  onToggleExpanded?: () => void;
}

type NotificationTag = ReturnType<typeof getNotificationTag>;

/** The notification driving the row's action/sender (most recent first). */
const getFirstNotification = (item: WithNotification<EntityData>) =>
  item.notifications?.()?.[0];

const isUnreadNotification = (notification?: Notification) =>
  notification ? !notification.viewed_at && !notification.done : false;

const getGithubSender = (entity: EntityData, notification?: Notification) => {
  const content = notification?.notification_metadata.content as
    | { senderGithubLogin?: string | null }
    | undefined;
  const pr =
    entity.type === 'foreign' && entity.foreignSource === 'github_pull_request'
      ? entity.metadata
      : undefined;
  const login = content?.senderGithubLogin ?? pr?.authorLogin ?? undefined;
  let imageUrl: string | undefined;
  if (content?.senderGithubLogin) {
    imageUrl = `https://github.com/${encodeURIComponent(content.senderGithubLogin)}.png?size=80`;
  } else if (pr?.authorId) {
    imageUrl = `https://avatars.githubusercontent.com/u/${pr.authorId}?s=80&v=4`;
  } else if (login) {
    imageUrl = `https://github.com/${encodeURIComponent(login)}.png?size=80`;
  }

  return { id: login, fallbackName: login, imageUrl };
};

const getNotificationSenderFallbackName = (
  notification: Notification
): string | undefined => {
  const content = notification.notification_metadata.content as
    | { sender?: string; senderGithubLogin?: string }
    | undefined;

  switch (notification.notification_metadata.tag) {
    case 'new_email':
      return content?.sender ?? undefined;
    case 'ai_response':
      return 'Macro agent';
    case 'channel_message_send':
      return content?.sender ?? notification.sender_id ?? undefined;
    case 'github_pr_status_changed':
    case 'github_review_requested':
    case 'github_pr_comment':
    case 'github_pr_mention':
    case 'github_pr_review':
      return content?.senderGithubLogin ?? notification.sender_id ?? undefined;
    default:
      return undefined;
  }
};

const getTimestamp = (entity: EntityData, notification?: Notification) => {
  const messageTime =
    entity.type === 'channel'
      ? entity.latestRootMessage?.createdAt
      : entity.type === 'channel_message' || entity.type === 'channel_thread'
        ? (entity.createdAt ?? entity.updatedAt)
        : undefined;
  const raw =
    messageTime ??
    notification?.created_at ??
    notification?.updated_at ??
    entity.updatedAt ??
    entity.createdAt;
  return raw != null ? String(raw) : undefined;
};

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('') || '?';

type SenderIconProps = {
  class?: string;
  senderId?: string;
};

export function SenderIcon(props: SenderIconProps) {
  // Bot senders render their own avatar; Macro AI keeps its dedicated logo.
  const botSender = () => {
    const sender = props.senderId
      ? senderFromStorageId(props.senderId)
      : undefined;
    if (sender?.type !== 'bot' || isMacroAgentId(sender.id)) return;
    return sender;
  };

  return (
    <div class={cn('shrink-0 size-(--user-icon-width)', props.class)}>
      <Show
        when={botSender()}
        fallback={<UserIcon id={props.senderId ?? ''} size="fill" />}
      >
        {(bot) => (
          <BotIcon name={bot().name} avatarUrl={bot().avatar_url} size="fill" />
        )}
      </Show>
    </div>
  );
}

function Avatar(props: {
  senderId?: string;
  fallbackName?: string;
  imageUrl?: string;
}) {
  const parsedSender = () =>
    props.senderId ? senderFromStorageId(props.senderId) : undefined;
  const isMacroAgent = () => {
    const sender = parsedSender();
    return sender?.type === 'bot' && isMacroAgentId(sender.id);
  };

  return (
    <Switch
      fallback={
        <span class="text-xs text-ink-muted">
          {initials(props.fallbackName ?? props.senderId ?? '')}
        </span>
      }
    >
      <Match when={props.imageUrl}>
        {(url) => <img src={url()} alt="" class="size-full object-cover" />}
      </Match>
      <Match when={isMacroAgent()}>
        <MacroLogo class="m-auto size-1/2 text-accent" />
      </Match>
      <Match when={props.senderId}>
        {(senderId) => <SenderIcon senderId={senderId()} />}
      </Match>
    </Switch>
  );
}

const tagBubbleIcon = (tag: NotificationTag) =>
  match(tag)
    .with('new_email', () => () => (
      <span class="grid size-3 place-items-center">
        <EntityIcon targetType="email" size="fill" />
      </span>
    ))
    .with('task_assigned', () => () => (
      <span class="grid size-3 place-items-center">
        <EntityIcon targetType="task" size="fill" />
      </span>
    ))
    .with('ai_response', () => () => (
      <span class="grid size-3 place-items-center">
        <EntityIcon targetType="chat" size="fill" />
      </span>
    ))
    .with('channel_mention', 'mentioned_in_document_comment', () => () => (
      <AtIcon class="size-3" />
    ))
    .with('document_mention', () => () => <FilesIcon class="size-3" />)
    .with(
      'channel_message_reply',
      'replied_to_document_comment_thread',
      () => () => <ArrowBendUpLeftIcon class="size-3" />
    )
    .with('commented_on_document', () => () => (
      <ChatCircleIcon class="size-3" />
    ))
    .with('channel_message_send', () => () => <ChatTextIcon class="size-3" />)
    .with('channel_invite', 'invite_to_team', () => () => (
      <UserPlusIcon class="size-3" />
    ))
    .with('call_started', () => () => <PhoneIcon class="size-3" />)
    .with(
      'github_pr_status_changed',
      'github_pr_check_run',
      'github_review_requested',
      'github_pr_comment',
      'github_pr_mention',
      'github_pr_review',
      () => () => <GithubIcon class="size-3" />
    )
    .with(
      P.when((value) => value?.startsWith('github_') ?? false),
      () => () => <GithubIcon class="size-3" />
    )
    .otherwise(() => undefined);

/** Avatar action bubble derived from the notification tag (mention, reply, …). */
function ActionBubble(props: { tag: NotificationTag }) {
  const renderIcon = () => tagBubbleIcon(props.tag);

  return (
    <Show when={renderIcon()}>
      {(renderIcon) => (
        <span class="absolute -bottom-1 -right-1 grid size-5 place-items-center overflow-hidden rounded-full bg-surface text-ink-muted ring-2 ring-surface">
          {renderIcon()()}
        </span>
      )}
    </Show>
  );
}

function Badge(props: { unread: boolean }) {
  return (
    <Show when={props.unread}>
      <span class="ml-auto flex shrink-0 items-center">
        <span class="size-2 rounded-full bg-accent" />
      </span>
    </Show>
  );
}

function PropertyPills(props: { entityId: string; properties?: PropertyT[] }) {
  const properties = createMemo(() => props.properties ?? []);

  const saveMutation = useBulkSaveEntityPropertiesMutation();

  const saveOne = (property: PropertyT, apiValues: PropertyApiValues) =>
    saveMutation.mutateAsync({
      properties: [
        {
          entityId: props.entityId,
          entityType: EntityType.TASK,
          property,
          apiValues,
        },
      ],
    });

  const saveHandler: PropertySaveHandler = {
    saveProperty: (property, value) => saveOne(property, value),
    saveDate: (property, date) =>
      saveOne(property, { valueType: 'DATE', value: date }),
  };

  return (
    <Show when={properties().length}>
      <PropertiesProvider
        entityType={EntityType.TASK}
        canEdit={true}
        properties={properties}
        onRefresh={() => {}}
        onPropertyAdded={() => {}}
        onPropertyDeleted={() => {}}
        saveHandler={saveHandler}
      >
        <div class="flex flex-wrap items-center gap-1 text-xs">
          <For each={properties()}>
            {(property) => <ListPropertyValue property={property} />}
          </For>
        </div>
      </PropertiesProvider>
    </Show>
  );
}

const relativeTime = (timestamp: string | undefined): string | undefined =>
  timestamp ? formatCompactRelativeTimestamp(timestamp) : undefined;

const createSenderDisplayName = (
  senderId: () => string | undefined,
  fallbackName?: () => string | undefined
) => {
  const macroId = () => {
    const id = senderId();
    return id ? tryMacroId(id) : undefined;
  };

  const [displayName] = useDisplayName(macroId());

  const botName = () => {
    const id = senderId();
    if (!id) return undefined;

    const parsed = senderFromStorageId(id);
    if (parsed.type !== 'bot') return undefined;

    if (parsed.name) return parsed.name;
    return parsed.id === MACRO_AI_BOT_ID ? MACRO_AI_NAME : 'Bot';
  };

  return () => botName() || displayName() || fallbackName?.() || senderId();
};

const buildActionLabel = (args: {
  sender?: string;
  action: string;
  location?: string;
}): string =>
  [args.sender, args.action, args.location].filter(Boolean).join(' ');

const channelLocation = (entity: EntityData): string | undefined => {
  if (
    entity.type !== 'channel' &&
    entity.type !== 'channel_message' &&
    entity.type !== 'channel_thread'
  ) {
    return undefined;
  }
  if (entity.channelType === 'direct_message') return undefined;
  return entity.name.startsWith('#') ? entity.name : `#${entity.name}`;
};

const entityLocation = (entity: EntityData): string | undefined => {
  if (
    (entity.type === 'channel' ||
      entity.type === 'channel_message' ||
      entity.type === 'channel_thread') &&
    entity.channelType === 'direct_message'
  ) {
    return undefined;
  }
  return entity.name;
};

const githubLocation = (entity: EntityData): string | undefined => {
  if (
    entity.type !== 'foreign' ||
    entity.foreignSource !== 'github_pull_request'
  ) {
    return entity.name;
  }
  return `${entity.metadata.owner}/${entity.metadata.repo}#${entity.metadata.number}`;
};

const githubAction = (notification?: Notification): string => {
  const metadata = notification?.notification_metadata;

  return match(metadata)
    .with(
      { tag: 'github_pr_status_changed', content: { status: 'merged' } },
      () => 'merged'
    )
    .with(
      { tag: 'github_pr_status_changed', content: { status: 'closed' } },
      () => 'closed'
    )
    .with({ tag: 'github_review_requested' }, () => 'requested your review on')
    .with({ tag: 'github_pr_comment' }, () => 'commented on')
    .with({ tag: 'github_pr_mention' }, () => 'mentioned you in')
    .with({ tag: 'github_pr_review' }, () => 'reviewed')
    .otherwise(() => 'updated');
};

function BaseCard(props: {
  selected?: boolean;
  highlighted?: boolean;
  onClick?: (event: MouseEvent) => void;
  unread: boolean;
  leading: JSX.Element;
  title: JSX.Element;
  preview?: string;
  attachments?: InboxCardAttachment[];
  entityId: string;
  properties?: PropertyT[];
  timestamp?: string;
  /** Extra controls rendered in the meta line, after the timestamp. */
  metaActions?: JSX.Element;
}) {
  return (
    <InboxCard.Root
      dimmed={!props.unread}
      selected={props.selected}
      highlighted={props.highlighted}
      onClick={props.onClick}
    >
      {props.leading}
      <InboxCard.Body>
        <InboxCard.Header>
          <InboxCard.Title>{props.title}</InboxCard.Title>
          <Badge unread={props.unread} />
        </InboxCard.Header>

        <Show when={props.preview?.trim()}>
          {(value) => (
            <InboxCard.Content class="truncate text-sm text-ink/60">
              <StaticMarkdown
                markdown={value()}
                singleLine
                theme={unifiedListMarkdownTheme}
              />
            </InboxCard.Content>
          )}
        </Show>

        <PropertyPills
          entityId={props.entityId}
          properties={props.properties}
        />

        <Show when={props.attachments?.length}>
          <InboxCard.Attachments items={props.attachments!} />
        </Show>

        <Show when={props.timestamp || props.metaActions}>
          <InboxCard.Meta timestamp={relativeTime(props.timestamp)}>
            {props.metaActions}
          </InboxCard.Meta>
        </Show>
      </InboxCard.Body>
    </InboxCard.Root>
  );
}

export function ChannelCardLayout(props: InboxCardLayoutProps) {
  const entity = createMemo(() => props.item.entity);

  const senderId = () => {
    const value = props.item.entity;
    return value.type === 'channel'
      ? value.latestRootMessage?.senderId
      : undefined;
  };

  const senderName = createSenderDisplayName(senderId);

  const text = createMemo(() => {
    const location = channelLocation(entity());
    const tag = getNotificationTag(props.item.notification);
    let action = 'sent a message';
    if (tag === 'channel_mention') {
      action = location ? 'mentioned you in' : 'mentioned you';
    } else if (location) {
      action = 'sent a message in';
    }

    let content = itemContent(entity(), props.item.notification);
    if (props.item.entity.type === 'channel') {
      content = props.item.entity.latestRootMessage?.content;
    }

    return {
      title: buildActionLabel({
        sender: senderName(),
        action,
        location,
      }),
      content,
    };
  });

  const isDM = createMemo(() => {
    const value = entity();
    return value.type === 'channel' && value.channelType === 'direct_message';
  });

  return (
    <InboxCard.Root
      dimmed={!props.item.unread}
      selected={props.selected}
      highlighted={props.highlighted}
      onClick={props.onClick}
    >
      <Show
        when={!isDM()}
        fallback={
          <InboxCard.Icon fallback={<Avatar senderId={senderId()} />}>
            <ActionBubble tag={getNotificationTag(props.item.notification)} />
          </InboxCard.Icon>
        }
      >
        <InboxCard.Icon
          fallback={
            <EntityIcon
              class="size-3"
              targetType={getEntityIconType(entity())}
              size="fill"
              theme="monochrome"
            />
          }
        />
      </Show>
      <InboxCard.Body>
        <InboxCard.Header>
          <InboxCard.Title>{text().title}</InboxCard.Title>
          <Badge unread={props.item.unread} />
        </InboxCard.Header>

        <div class="flex items-center gap-1">
          <Show when={!isDM()}>
            <span class="flex gap-1 items-center text-xs">
              <Show when={senderId()}>
                {(id) => (
                  <UserIcon
                    id={id()}
                    size="sm"
                    suppressClick
                    showTooltip={false}
                  />
                )}
              </Show>
              {senderName()}
            </span>
          </Show>
          <Show when={text().content?.trim()}>
            {(value) => (
              <InboxCard.Content class="truncate text-sm text-ink/60">
                <StaticMarkdown
                  markdown={value()}
                  singleLine
                  theme={unifiedListMarkdownTheme}
                />
              </InboxCard.Content>
            )}
          </Show>
        </div>

        <Show when={props.item.timestamp}>
          <InboxCard.Meta timestamp={relativeTime(props.item.timestamp)} />
        </Show>
      </InboxCard.Body>
    </InboxCard.Root>
  );
}

export function ChannelMessageCardLayout(props: InboxCardLayoutProps) {
  const senderId = () => {
    const value = props.item.entity;
    return value.type === 'channel_message' ? value.senderId : undefined;
  };

  const senderName = createSenderDisplayName(senderId);

  const text = createMemo(() => {
    const location = channelLocation(props.item.entity);
    const tag = getNotificationTag(props.item.notification);
    let action = 'sent a message';
    if (tag === 'channel_mention') {
      action = location ? 'mentioned you in' : 'mentioned you';
    } else if (location) {
      action = 'sent a message in';
    }

    return {
      title: buildActionLabel({ sender: senderName(), action, location }),
      content: itemContent(props.item.entity, props.item.notification),
    };
  });

  return (
    <BaseCard
      entityId={props.item.entity.id}
      selected={props.selected}
      highlighted={props.highlighted}
      onClick={props.onClick}
      unread={props.item.unread}
      timestamp={props.item.timestamp}
      leading={
        <InboxCard.Icon fallback={<Avatar senderId={senderId()} />}>
          <ActionBubble tag={getNotificationTag(props.item.notification)} />
        </InboxCard.Icon>
      }
      title={text().title}
      preview={text().content}
    />
  );
}

const notificationTime = (notification: Notification): number => {
  const raw = notification.created_at ?? notification.updated_at;
  const time = raw != null ? Date.parse(String(raw)) : 0;
  return Number.isNaN(time) ? 0 : time;
};

function ThreadReplySubItem(props: {
  notification: Notification;
  threadEntityId: string;
  selected?: boolean;
  onClick?: (event: MouseEvent) => void;
}) {
  const senderId = () => props.notification.sender_id ?? undefined;
  const senderFallbackName = () =>
    getNotificationSenderFallbackName(props.notification);
  const senderName = createSenderDisplayName(senderId, senderFallbackName);

  const messageContent = () => {
    const notification = props.notification;
    const meta = notification.notification_metadata;
    if (meta.tag !== 'channel_message_reply') return;

    return meta.content.messageContent;
  };

  const action = () => {
    const tag = getNotificationTag(props.notification);
    if (tag === 'channel_mention') return 'mentioned you';
    if (tag === 'channel_message_reply') return 'replied';
    return 'sent a message';
  };

  const timestamp = () => {
    const raw = props.notification.created_at ?? props.notification.updated_at;
    return raw != null ? String(raw) : undefined;
  };

  return (
    <BaseCard
      entityId={props.threadEntityId}
      selected={props.selected}
      onClick={props.onClick}
      unread={isUnreadNotification(props.notification)}
      timestamp={timestamp()}
      leading={
        <InboxCard.Icon
          fallback={
            <Avatar senderId={senderId()} fallbackName={senderFallbackName()} />
          }
        >
          <ActionBubble tag={getNotificationTag(props.notification)} />
        </InboxCard.Icon>
      }
      title={buildActionLabel({ sender: senderName(), action: action() })}
      preview={messageContent()}
    />
  );
}

export function ChannelThreadCardLayout(props: InboxCardLayoutProps) {
  const isLatestNotificationReply = createMemo(() => {
    const notification = props.item.notification;
    const notificationMetadata = notification?.notification_metadata;

    return notificationMetadata?.tag === 'channel_message_reply';
  });

  // When the latest notification is a reply, the thread's notifications become
  // expandable sub items (most recent first).
  const subItems = createMemo(() => {
    if (!isLatestNotificationReply()) return [];
    const notifications = props.item.entity.notifications?.() ?? [];
    return notifications.toSorted(
      (a, b) => notificationTime(b) - notificationTime(a)
    );
  });
  const hasSubItems = () => subItems().length > 0;

  const [localExpanded, setLocalExpanded] = createSignal(false);
  const expanded = () => props.expanded ?? localExpanded();
  const toggleExpanded = () => {
    if (props.onToggleExpanded) {
      props.onToggleExpanded();
      return;
    }
    setLocalExpanded((value) => !value);
  };

  const senderId = createMemo(() => {
    const value = props.item.entity;

    if (isLatestNotificationReply()) {
      return props.item.notification?.sender_id ?? undefined;
    }

    return value.type === 'channel_thread' ? value.senderId : undefined;
  });

  const senderName = createSenderDisplayName(senderId);

  const text = createMemo(() => {
    const metadata = props.item.notification?.notification_metadata;
    const location = channelLocation(props.item.entity);
    let action = 'started a thread';
    if (metadata?.tag === 'channel_mention') {
      action = location ? 'mentioned you in' : 'mentioned you';
    } else if (metadata?.tag === 'channel_message_reply') {
      action = location ? 'replied in' : 'replied';
    } else if (location) {
      action = 'started a thread in';
    }

    let content = itemContent(props.item.entity, props.item.notification);
    if (metadata?.tag === 'channel_message_reply') {
      content = metadata.content.messageContent;
    }

    return {
      title: buildActionLabel({ sender: senderName(), action, location }),
      content,
    };
  });

  const attachments = createMemo(() => {
    if (
      isLatestNotificationReply() ||
      props.item.entity.type !== 'channel_thread'
    )
      return;

    const itemAttachments = props.item.entity.attachments;

    return itemAttachments.map((attachment): InboxCardAttachment => {
      const media = mapMediaItems([attachment])[0];
      if (media) {
        return {
          id: media.id,
          src: media.src,
          kind: media.kind,
          thumbSrc: media.thumbSrc,
        };
      }
      return {
        id: attachment.entity_id,
        fallback: () => (
          <ItemPreview
            id={attachment.entity_id}
            type={stringToItemType(attachment.entity_type)}
          />
        ),
      };
    });
  });

  return (
    <div class="flex flex-col gap-1">
      <BaseCard
        entityId={props.item.entity.id}
        selected={props.selected}
        highlighted={props.highlighted}
        onClick={props.onClick}
        unread={props.item.unread}
        timestamp={props.item.timestamp}
        leading={
          <Show
            when={isLatestNotificationReply()}
            fallback={
              <InboxCard.Icon fallback={<Avatar senderId={senderId()} />}>
                <ActionBubble
                  tag={getNotificationTag(props.item.notification)}
                />
              </InboxCard.Icon>
            }
          >
            <InboxCard.Icon
              fallback={<ChatTextIcon class="size-4 shrink-0" />}
            />
          </Show>
        }
        title={text().title}
        preview={text().content}
        attachments={attachments()}
        metaActions={
          hasSubItems() ? (
            <>
              <Show when={props.item.timestamp}>
                <span aria-hidden="true">•</span>
              </Show>
              <button
                type="button"
                class="rounded text-ink-extra-muted transition-colors hover:text-ink-muted focus-visible:outline-none focus-visible:ring focus-visible:ring-accent/40"
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  toggleExpanded();
                }}
              >
                {expanded() ? 'Hide sub items' : 'Show sub items'}
              </button>
            </>
          ) : undefined
        }
      />
      <Show when={expanded() && hasSubItems()}>
        <div class="ml-5 flex flex-col gap-1 border-l border-edge-muted pl-4">
          <For each={subItems()}>
            {(notification) => (
              <ThreadReplySubItem
                notification={notification}
                threadEntityId={props.item.entity.id}
                onClick={props.onClick}
              />
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}

export function DocumentCardLayout(props: InboxCardLayoutProps) {
  const senderId = () => props.item.notification?.sender_id ?? undefined;

  const senderFallbackName = () =>
    props.item.notification
      ? getNotificationSenderFallbackName(props.item.notification)
      : undefined;

  const senderName = createSenderDisplayName(senderId, senderFallbackName);

  const text = createMemo(() => {
    const metadata = props.item.notification?.notification_metadata;
    const location = entityLocation(props.item.entity);
    const content = itemContent(props.item.entity, props.item.notification);

    if (metadata?.tag === 'document_mention') {
      return {
        title: buildActionLabel({
          sender: senderName(),
          action: 'shared',
          location,
        }),
        content: metadata.content.messageContent,
      };
    }

    if (metadata?.tag === 'mentioned_in_document_comment') {
      let action = 'mentioned you';
      if (location) action = 'mentioned you in';

      return {
        title: buildActionLabel({
          sender: senderName(),
          action,
          location,
        }),
        content,
      };
    }

    if (metadata?.tag === 'replied_to_document_comment_thread') {
      let action = 'replied';
      if (location) action = 'replied in';

      return {
        title: buildActionLabel({
          sender: senderName(),
          action,
          location,
        }),
        content,
      };
    }

    return { title: props.item.entity.name, content };
  });

  return (
    <BaseCard
      entityId={props.item.entity.id}
      selected={props.selected}
      highlighted={props.highlighted}
      onClick={props.onClick}
      unread={props.item.unread}
      timestamp={props.item.timestamp}
      leading={
        <InboxCard.Icon
          fallback={
            <Show
              when={props.item.notification}
              fallback={
                <EntityIcon targetType={getEntityIconType(props.item.entity)} />
              }
            >
              <Avatar
                senderId={senderId()}
                fallbackName={senderFallbackName()}
              />
            </Show>
          }
        >
          <ActionBubble tag={getNotificationTag(props.item.notification)} />
        </InboxCard.Icon>
      }
      title={text().title}
      preview={text().content}
    />
  );
}

export function TaskCardLayout(props: InboxCardLayoutProps) {
  const senderId = () =>
    props.item.notification?.sender_id ?? props.item.entity.ownerId;

  const senderFallbackName = () =>
    props.item.notification
      ? getNotificationSenderFallbackName(props.item.notification)
      : undefined;

  const senderName = createSenderDisplayName(senderId, senderFallbackName);

  const text = createMemo(() => {
    const content = itemContent(props.item.entity, props.item.notification);

    if (getNotificationTag(props.item.notification) === 'task_assigned') {
      return {
        title: buildActionLabel({
          sender: senderName(),
          action: 'assigned you a task',
        }),
        content: content || props.item.entity.name,
      };
    }

    return { title: props.item.entity.name, content };
  });

  return (
    <BaseCard
      entityId={props.item.entity.id}
      selected={props.selected}
      highlighted={props.highlighted}
      onClick={props.onClick}
      unread={props.item.unread}
      timestamp={props.item.timestamp}
      leading={
        <InboxCard.Icon
          fallback={
            <Show
              when={props.item.notification}
              fallback={
                <EntityIcon targetType={getEntityIconType(props.item.entity)} />
              }
            >
              <Avatar
                senderId={senderId()}
                fallbackName={senderFallbackName()}
              />
            </Show>
          }
        >
          <ActionBubble tag={getNotificationTag(props.item.notification)} />
        </InboxCard.Icon>
      }
      title={text().title}
      preview={text().content}
      properties={getInboxTaskProperties(props.item.entity)}
    />
  );
}

export function AiCardLayout(props: InboxCardLayoutProps) {
  const senderId = () => props.item.notification?.sender_id ?? undefined;

  const senderFallbackName = () => {
    return props.item.notification
      ? getNotificationSenderFallbackName(props.item.notification)
      : 'Ai';
  };

  const senderName = createSenderDisplayName(senderId, () => 'Macro');

  const text = createMemo(() => {
    const content = itemContent(props.item.entity, props.item.notification);
    const location = entityLocation(props.item.entity);

    if (getNotificationTag(props.item.notification) !== 'ai_response') {
      return { title: props.item.entity.name, content };
    }

    let action = 'responded';
    if (location) action = 'responded in';

    return {
      title: buildActionLabel({
        sender: senderName(),
        action,
        location,
      }),
      content,
    };
  });

  return (
    <BaseCard
      entityId={props.item.entity.id}
      selected={props.selected}
      highlighted={props.highlighted}
      onClick={props.onClick}
      unread={props.item.unread}
      timestamp={props.item.timestamp}
      leading={
        <InboxCard.Icon
          fallback={
            <Show
              when={props.item.notification}
              fallback={
                <EntityIcon targetType={getEntityIconType(props.item.entity)} />
              }
            >
              <Avatar
                senderId={senderId()}
                fallbackName={senderFallbackName()}
              />
            </Show>
          }
        >
          <ActionBubble tag={getNotificationTag(props.item.notification)} />
        </InboxCard.Icon>
      }
      title={text().title}
      preview={text().content}
    />
  );
}

export function EmailCardLayout(props: InboxCardLayoutProps) {
  const senderId = () => props.item.notification?.sender_id ?? undefined;

  const senderFallbackName = () => {
    const entity = props.item.entity;
    if (entity.type !== 'email') return undefined;

    if (entity.senderName) return entity.senderName;

    return props.item.notification
      ? (getNotificationSenderFallbackName(props.item.notification) ??
          entity.senderEmail)
      : entity.senderEmail;
  };

  const senderName = createSenderDisplayName(senderId, senderFallbackName);

  const text = createMemo(() => {
    const metadata = props.item.notification?.notification_metadata;
    const content = itemContent(props.item.entity, props.item.notification);
    let subject: string | undefined;
    if (metadata?.tag === 'new_email') {
      subject = metadata.content.subject;
    }

    let entitySnippet: string | undefined;
    if (props.item.entity.type === 'email') {
      entitySnippet = props.item.entity.snippet;
    }

    return {
      title: buildActionLabel({
        sender: senderName(),
        action: 'sent an email',
      }),
      content: subject || entitySnippet || props.item.entity.name || content,
    };
  });

  return (
    <BaseCard
      entityId={props.item.entity.id}
      selected={props.selected}
      highlighted={props.highlighted}
      onClick={props.onClick}
      unread={props.item.unread}
      timestamp={props.item.timestamp}
      leading={
        <InboxCard.Icon
          fallback={
            <Avatar senderId={senderId()} fallbackName={senderFallbackName()} />
          }
        >
          <ActionBubble tag="new_email" />
        </InboxCard.Icon>
      }
      title={text().title}
      preview={text().content}
    />
  );
}

export function GithubCardLayout(props: InboxCardLayoutProps) {
  const sender = createMemo(() =>
    getGithubSender(props.item.entity, props.item.notification)
  );

  const senderId = () => sender().id;
  const senderFallbackName = () => sender().fallbackName;

  const avatarUrl = () => sender().imageUrl;

  const senderName = createSenderDisplayName(senderId, senderFallbackName);

  const text = createMemo(() => {
    const entity = props.item.entity;

    if (isGithubPrEntity(entity)) {
      const hasGithubNotification = getNotificationTag(
        props.item.notification
      )?.startsWith('github_');

      let sender = entity.metadata.authorLogin;
      let action = 'opened';
      if (hasGithubNotification) {
        sender = senderName() ?? entity.metadata.authorLogin;
        action = githubAction(props.item.notification);
      }

      return {
        title: buildActionLabel({
          sender,
          action,
          location: githubLocation(entity),
        }),
        content:
          getGithubTitle(entity, props.item.notification) ||
          entity.metadata.name,
      };
    }

    return {
      title: buildActionLabel({
        sender: senderName(),
        action: githubAction(props.item.notification),
        location: githubLocation(entity),
      }),
      content: getGithubTitle(entity, props.item.notification) || entity.name,
    };
  });

  return (
    <BaseCard
      entityId={props.item.entity.id}
      selected={props.selected}
      highlighted={props.highlighted}
      onClick={props.onClick}
      unread={props.item.unread}
      timestamp={props.item.timestamp}
      leading={
        <Show
          when={avatarUrl()}
          fallback={
            <InboxCard.Icon
              fallback={
                <EntityIcon
                  class="size-3"
                  targetType="githubPullRequest"
                  size="fill"
                  theme="monochrome"
                />
              }
            />
          }
        >
          <InboxCard.Icon
            fallback={
              <Avatar
                senderId={senderId()}
                fallbackName={senderFallbackName()}
                imageUrl={avatarUrl()}
              />
            }
          >
            <ActionBubble
              tag={
                getNotificationTag(props.item.notification) ??
                'github_pr_status_changed'
              }
            />
          </InboxCard.Icon>
        </Show>
      }
      title={text().title}
      preview={text().content}
    />
  );
}

export function CallCardLayout(props: InboxCardLayoutProps) {
  const senderId = () => props.item.notification?.sender_id ?? undefined;

  const senderName = createSenderDisplayName(senderId, () =>
    props.item.notification
      ? getNotificationSenderFallbackName(props.item.notification)
      : undefined
  );

  const text = createMemo(() => {
    const entity = props.item.entity;
    const content = itemContent(entity, props.item.notification);
    const location = entityLocation(entity);

    if (getNotificationTag(props.item.notification) === 'call_started') {
      return {
        title: buildActionLabel({
          sender: senderName(),
          action: location ? 'started a call in' : 'started a call',
          location,
        }),
        content,
      };
    }

    if (entity.type === 'call' && entity.status === 'MISSED') {
      return {
        title: entity.name ? `Missed call in #${entity.name}` : 'Missed call',
        content,
      };
    }

    if (entity.type === 'call' && entity.status === 'UNATTENDED') {
      return {
        title: entity.name
          ? `Call unattended in #${entity.name}`
          : 'Call unattended',
        content,
      };
    }

    return { title: entity.name ? `Call in #${entity.name}` : 'Call', content };
  });

  return (
    <BaseCard
      entityId={props.item.entity.id}
      selected={props.selected}
      highlighted={props.highlighted}
      onClick={props.onClick}
      unread={props.item.unread}
      timestamp={props.item.timestamp}
      leading={
        <InboxCard.Icon
          fallback={
            <EntityIcon
              class="size-3"
              targetType="call"
              size="fill"
              theme="monochrome"
            />
          }
        />
      }
      title={text().title}
    />
  );
}

export function GenericCardLayout(props: InboxCardLayoutProps) {
  const text = createMemo(() => ({
    title: props.item.entity.name
      ? `${props.item.entity.name} updated`
      : 'Updated',
    content: itemContent(props.item.entity, props.item.notification),
  }));

  return (
    <BaseCard
      entityId={props.item.entity.id}
      selected={props.selected}
      highlighted={props.highlighted}
      onClick={props.onClick}
      unread={props.item.unread}
      timestamp={props.item.timestamp}
      leading={
        <InboxCard.Icon
          fallback={
            <EntityIcon
              class="size-3"
              targetType={getEntityIconType(props.item.entity)}
              size="fill"
              theme="monochrome"
            />
          }
        />
      }
      title={text().title}
      preview={text().content}
    />
  );
}

export function InboxCardLayout(props: InboxCardLayoutProps) {
  const notificationTag = () => getNotificationTag(props.item.notification);
  const isGithub = () => {
    const entity = props.item.entity;
    const tag = notificationTag();

    if (tag?.startsWith('github_')) return true;

    return (
      entity.type === 'foreign' &&
      entity.foreignSource === 'github_pull_request'
    );
  };
  const isTask = () => {
    const entity = props.item.entity;

    return (
      notificationTag() === 'task_assigned' ||
      (entity.type === 'document' && entity.subType?.type === 'task')
    );
  };

  return (
    <Switch>
      <Match when={props.item.entity.type === 'email'}>
        <EmailCardLayout {...props} />
      </Match>
      <Match
        when={
          notificationTag() === 'call_started' ||
          props.item.entity.type === 'call'
        }
      >
        <CallCardLayout {...props} />
      </Match>
      <Match when={isGithub()}>
        <GithubCardLayout {...props} />
      </Match>
      <Match
        when={
          notificationTag() === 'ai_response' ||
          props.item.entity.type === 'chat'
        }
      >
        <AiCardLayout {...props} />
      </Match>
      <Match when={isTask()}>
        <TaskCardLayout {...props} />
      </Match>
      <Match when={props.item.entity.type === 'document'}>
        <DocumentCardLayout {...props} />
      </Match>
      <Match when={props.item.entity.type === 'channel'}>
        <ChannelCardLayout {...props} />
      </Match>
      <Match when={props.item.entity.type === 'channel_message'}>
        <ChannelMessageCardLayout {...props} />
      </Match>
      <Match when={props.item.entity.type === 'channel_thread'}>
        <ChannelThreadCardLayout {...props} />
      </Match>
      <Match when={true}>
        <GenericCardLayout {...props} />
      </Match>
    </Switch>
  );
}

export type InboxCardDisplayItem = {
  entity: WithNotification<EntityData>;
  notification?: Notification;
  unread: boolean;
  timestamp?: string;
};

export function toInboxCardDisplayItem(
  item: WithNotification<EntityData>
): InboxCardDisplayItem {
  const notification = getFirstNotification(item);

  return {
    entity: item,
    notification,
    unread: isUnreadNotification(notification),
    timestamp: getTimestamp(item, notification),
  };
}
