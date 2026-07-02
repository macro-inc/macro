import { ListPropertyValue } from '@app/component/next-soup/soup-view/views/tasks/list-property-value';
import { mapMediaItems } from '@channel/Media/media-items';
import { BotIcon } from '@channel/Message/BotIcon';
import { MACRO_AI_BOT_ID, MACRO_AI_NAME } from '@channel/macroAi';
import { EntityIcon, getEntityIconType } from '@core/component/EntityIcon';
import { ItemPreview } from '@core/component/ItemPreview';
import { StaticMarkdown } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import { unifiedListMarkdownTheme } from '@core/component/LexicalMarkdown/theme';
import { UserIcon } from '@core/component/UserIcon';
import { useUserId } from '@core/context/user';
import { isMacroAgentId } from '@core/constant/macroAgent';
import { tryMacroId, useDisplayName } from '@core/user';
import {
  type EntityData,
  isGithubPrEntity,
  type Notification,
  unreadFilterFn,
  type WithNotification,
} from '@entity';
import MacroLogo from '@icon/macro-logo.svg';
import GithubIcon from '@icon/mcp-github.svg';
import FilesIcon from '@phosphor/files.svg';
import GitMergeIcon from '@phosphor/git-merge.svg';
import GitPullRequestIcon from '@phosphor/git-pull-request.svg';
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
import { Avatar, cn } from '@ui';
import { createMemo, For, type JSX, Match, Show, Switch } from 'solid-js';
import { match, P } from 'ts-pattern';
import { InboxCard, type InboxCardAttachment } from './InboxCard';
import {
  formatCompactRelativeTimestamp,
  getGithubTitle,
  getInboxTaskProperties,
  getNotificationTag,
  itemContent,
} from './utils';
import { Dynamic } from 'solid-js/web';
import { plural } from '@core/util/string';

export interface InboxCardLayoutProps {
  /** The already-derived item to render. */
  item: InboxCardDisplayItem;
  selected?: boolean;
  highlighted?: boolean;
  onClick?: (event: MouseEvent) => void;
}

type NotificationTag = ReturnType<typeof getNotificationTag>;

/** The notification driving the row's action/sender (most recent first). */
const getFirstNotification = (item: WithNotification<EntityData>) =>
  item.notifications?.()?.[0];

const getGithubSender = (entity: EntityData, notification?: Notification) => {
  const meta = notification?.notification_metadata;
  if (
    meta &&
    meta.tag !== 'github_pr_status_changed' &&
    meta.tag !== 'github_review_requested' &&
    meta.tag !== 'github_pr_comment' &&
    meta.tag !== 'github_pr_mention' &&
    meta.tag !== 'github_pr_review' &&
    meta.tag !== 'github_pr_check_run'
  )
    return;

  const content = meta?.content;

  const pr = isGithubPrEntity(entity) ? entity.metadata : undefined;

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
    <div class={cn('shrink-0 size-full', props.class)}>
      <Show
        when={botSender()}
        fallback={
          <UserIcon id={props.senderId ?? ''} class="size-full" size="fill" />
        }
      >
        {(bot) => (
          <BotIcon name={bot().name} avatarUrl={bot().avatar_url} size="fill" />
        )}
      </Show>
    </div>
  );
}

function FloatingSenderBubble(props: {
  senderId?: string;
  fallbackName?: string;
  imageUrl?: string;
}) {
  return (
    <Show when={props.senderId || props.fallbackName || props.imageUrl}>
      <span class="absolute -right-1 -bottom-1 grid size-5 place-items-center overflow-hidden rounded-full bg-surface ring-2 ring-surface">
        <InboxAvatar
          senderId={props.senderId}
          fallbackName={props.fallbackName}
          imageUrl={props.imageUrl}
        />
      </span>
    </Show>
  );
}

function InboxAvatar(props: {
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
        <Avatar.Fallback class="text-base font-semibold">
          {initials(props.fallbackName ?? props.senderId ?? '')}
        </Avatar.Fallback>
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
      <EntityIcon
        class="size-5"
        targetType="email"
        theme="monochrome"
        size="fill"
      />
    ))
    .with('task_assigned', () => () => (
      <EntityIcon class="size-5" targetType="task" size="fill" />
    ))
    .with('ai_response', () => () => (
      <EntityIcon class="size-5" targetType="chat" size="fill" />
    ))
    .with('channel_mention', 'mentioned_in_document_comment', () => () => (
      <AtIcon class="size-5" />
    ))
    .with('document_mention', () => () => <FilesIcon class="size-5" />)
    .with(
      'channel_message_reply',
      'replied_to_document_comment_thread',
      () => () => <ArrowBendUpLeftIcon class="size-5" />
    )
    .with('commented_on_document', () => () => (
      <ChatCircleIcon class="size-5" />
    ))
    .with('channel_message_send', () => () => <ChatTextIcon class="size-5" />)
    .with('channel_invite', 'invite_to_team', () => () => (
      <UserPlusIcon class="size-5" />
    ))
    .with('call_started', () => () => <PhoneIcon class="size-5" />)
    .with(
      'github_pr_status_changed',
      'github_pr_check_run',
      'github_review_requested',
      'github_pr_comment',
      'github_pr_mention',
      'github_pr_review',
      () => () => <GithubIcon class="size-5" />
    )
    .with(
      P.when((value) => value?.startsWith('github_') ?? false),
      () => () => <GithubIcon class="size-5" />
    )
    .otherwise(() => undefined);

/** Avatar action bubble derived from the notification tag (mention, reply, …). */
function ActionBubble(props: { tag: NotificationTag }) {
  const renderIcon = () => tagBubbleIcon(props.tag);

  return (
    <Show when={renderIcon()}>
      {(renderIcon) => <Dynamic component={renderIcon()} />}
    </Show>
  );
}

function GithubStatusIcon(props: { status?: string }) {
  const statusClass = () => {
    if (props.status === 'merged') return 'text-note';
    if (props.status === 'closed') return 'text-failure';
    if (props.status === 'open') return 'text-success';
    return undefined;
  };

  return (
    <span class="grid size-6 place-items-center">
      <Show
        when={props.status === 'merged'}
        fallback={
          <Show
            when={props.status === 'open' || props.status === 'closed'}
            fallback={<GithubIcon class="size-6" />}
          >
            <GitPullRequestIcon class={cn('size-6', statusClass())} />
          </Show>
        }
      >
        <GitMergeIcon class="size-6 text-note" />
      </Show>
    </span>
  );
}

function Badge(props: { unread: boolean }) {
  return (
    <Show when={props.unread}>
      <span class="flex shrink-0 items-center">
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

  return () => {
    return botName() || displayName() || fallbackName?.() || senderId();
  };
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
}) {
  return (
    <InboxCard.Root
      dimmed={!props.unread}
      selected={props.selected}
      highlighted={props.highlighted}
      onClick={props.onClick}
    >
      <div class="col-start-1 row-start-1 row-span-2">{props.leading}</div>
      <InboxCard.Body class="contents">
        <InboxCard.Header class="col-start-2 row-start-1 self-center">
          <InboxCard.Title class="flex items-center gap-1 truncate">
            <Badge unread={props.unread} />
            {props.title}
          </InboxCard.Title>
        </InboxCard.Header>

        <div class="col-start-2 row-start-2 flex min-w-0 flex-col">
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
        </div>
      </InboxCard.Body>
      <Show when={props.timestamp}>
        <span class="col-start-3 row-start-1 self-start justify-self-end whitespace-nowrap text-xs text-ink-extra-muted">
          {relativeTime(props.timestamp)}
        </span>
      </Show>
    </InboxCard.Root>
  );
}

export function ChannelCardLayout(props: InboxCardLayoutProps) {
  const entity = createMemo(() => props.item.entity);

  const senderId = () => {
    const value = props.item.entity;

    if (value.type !== 'channel') return;

    const latestSender = value.latestRootMessage?.senderId;

    if (value.channelType === 'direct_message') {
      const otherParticipant = value.participantIds?.filter(
        (i) => i !== value.ownerId
      )?.[0];

      return latestSender ?? otherParticipant ?? 'Unknown';
    }

    return latestSender;
  };

  const senderName = createSenderDisplayName(senderId);
  const currentUserId = useUserId();
  const senderLabel = () =>
    senderId() === currentUserId() ? 'You' : senderName();

  const isDM = createMemo(() => {
    const value = entity();
    return value.type === 'channel' && value.channelType === 'direct_message';
  });

  const text = createMemo(() => {
    const location = channelLocation(entity());
    const tag = getNotificationTag(props.item.notification);

    let sender = isDM() ? entity().name || senderName() : '';
    let action = '';

    if (tag === 'document_mention' && isDM()) {
      action = 'shared a document with you';
    } else if (tag === 'channel_message_send' && isDM()) {
      action = 'sent you a message';
    }

    const content = itemContent(entity(), props.item.notification);

    return {
      title: buildActionLabel({
        sender,
        action,
        location,
      }),
      content,
    };
  });

  return (
    <InboxCard.Root
      dimmed={!props.item.unread}
      selected={props.selected}
      highlighted={props.highlighted}
      onClick={props.onClick}
    >
      <div class="col-start-1 row-start-1 row-span-2">
        <Show
          when={!isDM()}
          fallback={
            <InboxCard.Icon fallback={<InboxAvatar senderId={senderId()} />} />
          }
        >
          <InboxCard.Icon
            fallback={
              <EntityIcon
                class="size-5"
                targetType={getEntityIconType(entity())}
                size="fill"
                theme="monochrome"
              />
            }
          >
            {/* <FloatingSenderBubble senderId={senderId()} /> */}
          </InboxCard.Icon>
        </Show>
      </div>
      <InboxCard.Body class="contents">
        <InboxCard.Header class="col-start-2 row-start-1 self-center">
          <InboxCard.Title class="flex items-center gap-1">
            <Badge unread={props.item.unread} />
            {text().title}
          </InboxCard.Title>
        </InboxCard.Header>

        <div class="col-start-2 row-start-2 flex min-w-0 items-center gap-1 text-sm text-ink/60">
          <Show when={!isDM()}>
            <span class="flex gap-1 items-center whitespace-nowrap text-ink/80">
              {senderLabel()}:
            </span>
          </Show>
          <Show when={text().content?.trim()}>
            {(value) => (
              <InboxCard.Content class="truncate">
                <StaticMarkdown
                  markdown={value()}
                  singleLine
                  theme={unifiedListMarkdownTheme}
                />
              </InboxCard.Content>
            )}
          </Show>
        </div>
      </InboxCard.Body>
      <Show when={props.item.timestamp}>
        <span class="col-start-3 row-start-1 self-start justify-self-end whitespace-nowrap text-xs text-ink-extra-muted">
          {relativeTime(props.item.timestamp)}
        </span>
      </Show>
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
    if (location) {
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
        <InboxCard.Icon
          fallback={
            <ActionBubble tag={getNotificationTag(props.item.notification)} />
          }
        >
          {/* <FloatingSenderBubble senderId={senderId()} /> */}
        </InboxCard.Icon>
      }
      title={text().title}
      preview={text().content}
    />
  );
}

export function ChannelThreadCardLayout(props: InboxCardLayoutProps) {
  const isLatestNotificationReply = createMemo(() => {
    const notification = props.item.notification;
    const notificationMetadata = notification?.notification_metadata;

    return notificationMetadata?.tag === 'channel_message_reply';
  });

  const senderId = createMemo(() => {
    const value = props.item.entity;

    if (isLatestNotificationReply()) {
      return props.item.notification?.sender_id ?? undefined;
    }

    return value.type === 'channel_thread' ? value.senderId : undefined;
  });

  const isDM = createMemo(() => {
    const notification = props.item.notification;
    const meta = notification?.notification_metadata;
    return match(meta)
      .with(
        P.union(
          { tag: 'channel_mention' },
          { tag: 'channel_message_reply' },
          { tag: 'channel_message_send' }
        ),
        (m) => m.content.channelType === 'directMessage'
      )
      .otherwise(() => false);
  });

  const senderName = createSenderDisplayName(senderId);
  const currentUserId = useUserId();
  const senderLabel = () =>
    senderId() === currentUserId() ? 'You' : senderName();

  const rootSenderId = () => {
    const value = props.item.entity;
    return value.type === 'channel_thread' ? value.senderId : undefined;
  };

  const rootSenderName = createSenderDisplayName(rootSenderId);
  const rootSenderLabel = () =>
    rootSenderId() === currentUserId() ? 'You' : rootSenderName();

  const isReply = createMemo(() => {
    const metadata = props.item.notification?.notification_metadata;
    return metadata?.tag === 'channel_message_reply';
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

  const text = createMemo(() => {
    if (props.item.entity.type !== 'channel_thread') {
      return {
        title: '',
        content: '',
      };
    }

    const metadata = props.item.notification?.notification_metadata;
    const location = channelLocation(props.item.entity);

    let content = itemContent(props.item.entity, props.item.notification);
    if (metadata?.tag === 'channel_message_reply') {
      content = metadata.content.messageContent;
    }

    const attachments_ = props.item.entity.attachments;
    let context = attachments_
      ? `sent ${attachments_.length > 1 ? '' : 'an'} ${plural('attachment', attachments_.length)}`
      : undefined;

    if (
      metadata?.tag === 'channel_message_reply' &&
      props.item.entity.content.trim().length
    ) {
      context = props.item.entity.content.trim();
    }

    return {
      title: location,
      context,
      content,
    };
  });

  return (
    <InboxCard.Root
      class={isReply() ? 'grid-rows-[min-content_2rem_0.5rem]' : ''}
      dimmed={!props.item.unread}
      selected={props.selected}
      highlighted={props.highlighted}
      onClick={props.onClick}
    >
      <div class="col-start-1 row-start-2">
        <InboxCard.Icon
          fallback={
            <ActionBubble tag={getNotificationTag(props.item.notification)} />
          }
        >
          {/* <FloatingSenderBubble senderId={senderId()} /> */}
        </InboxCard.Icon>
      </div>
      <InboxCard.Body class="contents">
        <Show when={isReply()}>
          <div class="col-start-2 row-start-1 flex min-w-0 items-center gap-1 mb-1">
            <span
              aria-hidden="true"
              class="relative -ml-2 -mb-2 h-3 w-3 shrink-0 rounded-tl-md border-l border-t border-edge-muted"
            />
            <Show when={!isDM()}>
              <span class="flex gap-1 items-center text-xs whitespace-nowrap text-ink/80">
                <Show when={rootSenderId()}>
                  {(id) => (
                    <UserIcon
                      id={id()}
                      size="sm"
                      suppressClick
                      showTooltip={false}
                    />
                  )}
                </Show>
                {rootSenderLabel()}:
              </span>
            </Show>

            <Show when={text().context?.trim()}>
              {(value) => (
                <InboxCard.Content class="truncate text-xs text-ink/60">
                  <StaticMarkdown
                    markdown={value()}
                    singleLine
                    theme={unifiedListMarkdownTheme}
                  />
                </InboxCard.Content>
              )}
            </Show>
          </div>
        </Show>
        <div class={cn('col-start-2 row-start-2')}>
          <InboxCard.Header class="self-center">
            <InboxCard.Title class="flex items-center gap-1">
              <Badge unread={props.item.unread} />
              {text().title}
            </InboxCard.Title>
          </InboxCard.Header>

          <div class="flex min-w-0 items-center gap-1">
            <Show when={!isDM()}>
              <span class="flex gap-1 items-center text-sm whitespace-nowrap text-ink/80">
                {senderLabel()}:
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
        </div>

        <Show when={attachments()?.length}>
          <InboxCard.Attachments
            class="col-start-2 row-start-3"
            items={attachments()!}
          />
        </Show>
      </InboxCard.Body>
      <Show when={props.item.timestamp}>
        <span
          class={cn(
            'col-start-3 row-start-2 self-start justify-self-end whitespace-nowrap text-xs text-ink-extra-muted'
          )}
        >
          {relativeTime(props.item.timestamp)}
        </span>
      </Show>
    </InboxCard.Root>
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
              <ActionBubble tag={getNotificationTag(props.item.notification)} />
            </Show>
          }
        >
          {/* <FloatingSenderBubble */}
          {/*   senderId={senderId()} */}
          {/*   fallbackName={senderFallbackName()} */}
          {/* /> */}
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
                <EntityIcon
                  class="size-5"
                  size="fill"
                  targetType={getEntityIconType(props.item.entity)}
                />
              }
            >
              <ActionBubble tag={getNotificationTag(props.item.notification)} />
            </Show>
          }
        >
          {/* <FloatingSenderBubble */}
          {/*   senderId={senderId()} */}
          {/*   fallbackName={senderFallbackName()} */}
          {/* /> */}
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
                <EntityIcon
                  class="size-5"
                  targetType={getEntityIconType(props.item.entity)}
                  size="fill"
                />
              }
            >
              <ActionBubble tag={getNotificationTag(props.item.notification)} />
            </Show>
          }
        >
          {/* <FloatingSenderBubble */}
          {/*   senderId={senderId()} */}
          {/*   fallbackName={senderFallbackName()} */}
          {/* /> */}
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
    const subject = props.item.entity.name;

    let entitySnippet: string | undefined;
    if (props.item.entity.type === 'email') {
      entitySnippet = props.item.entity.snippet;
    }

    return {
      sender: senderName(),
      subject,
      content: entitySnippet,
    };
  });

  return (
    <InboxCard.Root
      dimmed={!props.item.unread}
      selected={props.selected}
      highlighted={props.highlighted}
      onClick={props.onClick}
    >
      <div class="col-start-1 row-start-1 row-span-3">
        <InboxCard.Icon fallback={<ActionBubble tag="new_email" />}>
          {/* <FloatingSenderBubble */}
          {/*   senderId={senderId()} */}
          {/*   fallbackName={senderFallbackName()} */}
          {/* /> */}
        </InboxCard.Icon>
      </div>
      <InboxCard.Body class="contents">
        <InboxCard.Header class="col-start-2 row-start-1 self-center">
          <InboxCard.Title class="flex items-center gap-1">
            <Badge unread={props.item.unread} />
            {text().sender}
          </InboxCard.Title>
        </InboxCard.Header>

        <Show when={text().subject?.trim()}>
          {(subject) => (
            <InboxCard.Content class="col-start-2 row-start-2 truncate text-sm text-ink/80">
              {subject()}
            </InboxCard.Content>
          )}
        </Show>

        <Show when={text().content?.trim()}>
          {(value) => (
            <InboxCard.Content class="col-start-2 row-start-3 truncate text-sm text-ink/60">
              <StaticMarkdown
                markdown={value()}
                singleLine
                theme={unifiedListMarkdownTheme}
              />
            </InboxCard.Content>
          )}
        </Show>
      </InboxCard.Body>
      <Show when={props.item.timestamp}>
        <span class="col-start-3 row-start-1 self-start justify-self-end whitespace-nowrap text-xs text-ink-extra-muted">
          {relativeTime(props.item.timestamp)}
        </span>
      </Show>
    </InboxCard.Root>
  );
}

export function GithubCardLayout(props: InboxCardLayoutProps) {
  const sender = createMemo(() =>
    getGithubSender(props.item.entity, props.item.notification)
  );

  const senderId = () => sender()?.id;
  const senderFallbackName = () => sender()?.fallbackName;

  const avatarUrl = () => sender()?.imageUrl;

  const senderName = createSenderDisplayName(senderId, senderFallbackName);

  const status = createMemo(() => {
    const metadata = props.item.notification?.notification_metadata;
    if (
      metadata?.tag === 'github_pr_status_changed' &&
      typeof metadata.content.status === 'string'
    ) {
      return metadata.content.status;
    }

    if (!isGithubPrEntity(props.item.entity)) return;

    return props.item.entity.metadata.status;
  });

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
        <InboxCard.Icon
          fallback={
            <Show
              when={
                !props.item.notification ||
                getNotificationTag(props.item.notification) ===
                  'github_pr_status_changed'
              }
              fallback={
                <ActionBubble
                  tag={
                    getNotificationTag(props.item.notification) ??
                    'github_pr_status_changed'
                  }
                />
              }
            >
              <GithubStatusIcon status={status()} />
            </Show>
          }
        >
          {/* <FloatingSenderBubble */}
          {/*   fallbackName={senderFallbackName()} */}
          {/*   imageUrl={avatarUrl()} */}
          {/* /> */}
        </InboxCard.Icon>
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
              class="size-5"
              targetType="call"
              size="fill"
              theme="monochrome"
            />
          }
        >
          {/* <FloatingSenderBubble senderId={senderId()} /> */}
        </InboxCard.Icon>
      }
      title={text().title}
      preview={text().content}
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
              class="size-5"
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
    unread: unreadFilterFn(item),
    timestamp: getTimestamp(item, notification),
  };
}
