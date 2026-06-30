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
import type { EntityData, Notification, WithNotification } from '@entity';
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
import { createMemo, For, type JSX, Match, Show, Switch } from 'solid-js';
import { match, P } from 'ts-pattern';
import { InboxCard, type InboxCardAttachment } from './InboxCard';
import {
  formatCompactRelativeTimestamp,
  getInboxTaskProperties,
  getInboxText,
  getNotificationTag,
  senderDisplayName,
  senderNameRaw,
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
  const imageUrl = content?.senderGithubLogin
    ? `https://github.com/${encodeURIComponent(content.senderGithubLogin)}.png?size=80`
    : pr?.authorId
      ? `https://avatars.githubusercontent.com/u/${pr.authorId}?s=80&v=4`
      : login
        ? `https://github.com/${encodeURIComponent(login)}.png?size=80`
        : undefined;

  return { id: login, fallbackName: login, imageUrl };
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

const entityIconFor = (entity: EntityData) => {
  switch (entity.type) {
    case 'email':
      return 'email';
    case 'call':
      return 'call';
    case 'channel':
    case 'channel_message':
    case 'channel_thread':
      return 'channel';
    case 'document':
      return entity.subType?.type === 'task' ? 'task' : 'md';
    case 'foreign':
      return 'githubPullRequest';
    default:
      return 'default';
  }
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

function SenderName(props: { senderId?: string; fallbackName?: string }) {
  const macroId = () =>
    props.senderId ? tryMacroId(props.senderId) : undefined;
  const [displayName] = useDisplayName(macroId());

  const botName = () => {
    if (!props.senderId) return;

    const parsed = senderFromStorageId(props.senderId);

    if (parsed.type !== 'bot') return;

    if (parsed.name) return parsed.name;

    return parsed.id === MACRO_AI_BOT_ID ? MACRO_AI_NAME : 'Bot';
  };

  return <>{botName() || displayName() || props.fallbackName || ''}</>;
}

const relativeTime = (timestamp: string | undefined): string | undefined =>
  timestamp ? formatCompactRelativeTimestamp(timestamp) : undefined;

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

        <Show when={props.timestamp}>
          <InboxCard.Meta timestamp={relativeTime(props.timestamp)} />
        </Show>
      </InboxCard.Body>
    </InboxCard.Root>
  );
}

export function ChannelCardLayout(props: InboxCardLayoutProps) {
  const text = createMemo(() =>
    getInboxText(props.item.entity, props.item.notification)
  );

  const entity = () => props.item.entity;
  const senderId = () => {
    const value = props.item.entity;
    return value.type === 'channel'
      ? value.latestRootMessage?.senderId
      : undefined;
  };
  const senderFallbackName = () =>
    senderNameRaw(props.item.entity, props.item.notification) ??
    senderDisplayName(props.item.entity, props.item.notification);

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
          <InboxCard.Icon
            fallback={
              <Avatar
                senderId={senderId()}
                fallbackName={senderFallbackName()}
              />
            }
          >
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
              <SenderName
                senderId={senderId()}
                fallbackName={senderFallbackName()}
              />
              :
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
  const text = createMemo(() =>
    getInboxText(props.item.entity, props.item.notification)
  );

  const senderId = () => {
    const value = props.item.entity;
    return value.type === 'channel_message' ? value.senderId : undefined;
  };
  const senderFallbackName = () =>
    senderNameRaw(props.item.entity, props.item.notification) ??
    senderDisplayName(props.item.entity, props.item.notification);

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
          <ActionBubble tag={getNotificationTag(props.item.notification)} />
        </InboxCard.Icon>
      }
      title={text().title}
      preview={text().content}
    />
  );
}

export function ChannelThreadCardLayout(props: InboxCardLayoutProps) {
  const text = createMemo(() => {
    const text = getInboxText(props.item.entity, props.item.notification);
    const metadata = props.item.notification?.notification_metadata;

    if (metadata?.tag === 'channel_message_reply') {
      return { ...text, content: metadata.content.messageContent };
    }

    return text;
  });

  const senderId = () => {
    const value = props.item.entity;
    return value.type === 'channel_thread' ? value.senderId : undefined;
  };
  const senderFallbackName = () =>
    senderNameRaw(props.item.entity, props.item.notification) ??
    senderDisplayName(props.item.entity, props.item.notification);

  const isLatestNotificationReply = () => {
    const notification = props.item.notification;
    const notificationMetadata = notification?.notification_metadata;

    return notificationMetadata?.tag === 'channel_message_reply';
  };

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
            <InboxCard.Icon
              fallback={
                <Avatar
                  senderId={senderId()}
                  fallbackName={senderFallbackName()}
                />
              }
            >
              <ActionBubble tag={getNotificationTag(props.item.notification)} />
            </InboxCard.Icon>
          }
        >
          <InboxCard.Icon fallback={<ChatTextIcon class="size-4 shrink-0" />} />
        </Show>
      }
      title={text().title}
      preview={text().content}
      attachments={attachments()}
    />
  );
}

export function DocumentCardLayout(props: InboxCardLayoutProps) {
  const text = createMemo(() =>
    getInboxText(props.item.entity, props.item.notification)
  );

  const senderId = () => props.item.notification?.sender_id ?? undefined;
  const senderFallbackName = () =>
    senderNameRaw(props.item.entity, props.item.notification) ??
    senderDisplayName(props.item.entity, props.item.notification);

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
  const text = createMemo(() =>
    getInboxText(props.item.entity, props.item.notification)
  );

  const senderId = () =>
    props.item.notification?.sender_id ?? props.item.entity.ownerId;
  const senderFallbackName = () =>
    senderNameRaw(props.item.entity, props.item.notification) ??
    senderDisplayName(props.item.entity, props.item.notification);

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
  const text = createMemo(() =>
    getInboxText(props.item.entity, props.item.notification)
  );

  const senderId = () => props.item.notification?.sender_id ?? undefined;
  const senderFallbackName = () =>
    senderNameRaw(props.item.entity, props.item.notification) ??
    senderDisplayName(props.item.entity, props.item.notification);

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
  const text = createMemo(() =>
    getInboxText(props.item.entity, props.item.notification)
  );

  const senderId = () => props.item.notification?.sender_id ?? undefined;
  const senderFallbackName = () =>
    senderNameRaw(props.item.entity, props.item.notification) ??
    senderDisplayName(props.item.entity, props.item.notification);

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
  const text = createMemo(() =>
    getInboxText(props.item.entity, props.item.notification)
  );

  const sender = () =>
    getGithubSender(props.item.entity, props.item.notification);
  const senderId = () => sender().id;
  const senderFallbackName = () => sender().fallbackName;
  const avatarUrl = () => sender().imageUrl;

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
  const text = createMemo(() =>
    getInboxText(props.item.entity, props.item.notification)
  );

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
  const text = createMemo(() =>
    getInboxText(props.item.entity, props.item.notification)
  );

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
              targetType={entityIconFor(props.item.entity)}
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
