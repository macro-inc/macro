import { ListPropertyValue } from '@app/component/next-soup/soup-view/views/tasks/list-property-value';
import { formatCallDuration } from '@block-call/utils';
import { BotIcon } from '@channel/Message/BotIcon';
import { MACRO_AI_BOT_ID, MACRO_AI_NAME } from '@channel/macroAi';
import { EntityIcon, getEntityIconType } from '@core/component/EntityIcon';
import { StaticMarkdown } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import {
  createTheme,
  twoLineClampMarkdownTheme,
  unifiedListMarkdownTheme,
} from '@core/component/LexicalMarkdown/theme';
import { UserIcon } from '@core/component/UserIcon';
import { isMacroAgentId } from '@core/constant/macroAgent';
import { useUserId } from '@core/context/user';
import { tryMacroId, useDisplayName } from '@core/user';
import { plural } from '@core/util/string';
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
import PaperclipIcon from '@phosphor-icons/core/regular/paperclip.svg?component-solid';
import PhoneIcon from '@phosphor-icons/core/regular/phone.svg?component-solid';
import UserPlusIcon from '@phosphor-icons/core/regular/user-plus.svg?component-solid';
import {
  PropertiesProvider,
  type PropertySaveHandler,
} from '@property/context/PropertiesContext';
import type { PropertyApiValues, Property as PropertyT } from '@property/types';
import { senderFromStorageId } from '@queries/channel/message-sender';
import { useBulkSaveEntityPropertiesMutation } from '@queries/properties/entity';
import { EntityType } from '@service-storage/generated/schemas';
import { Avatar, cn, Tooltip } from '@ui';
import { createMemo, For, type JSX, Match, Show, Switch } from 'solid-js';
import { Dynamic } from 'solid-js/web';
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
        class="size-4"
        targetType="email"
        theme="monochrome"
        size="fill"
      />
    ))
    .with('task_assigned', () => () => (
      <EntityIcon class="size-4" targetType="task" size="fill" />
    ))
    .with('ai_response', () => () => (
      <EntityIcon class="size-4" targetType="chat" size="fill" />
    ))
    .with('channel_mention', 'mentioned_in_document_comment', () => () => (
      <AtIcon class="size-4" />
    ))
    .with('document_mention', () => () => <FilesIcon class="size-4" />)
    .with(
      'channel_message_reply',
      'replied_to_document_comment_thread',
      () => () => <ArrowBendUpLeftIcon class="size-4" />
    )
    .with('commented_on_document', () => () => (
      <ChatCircleIcon class="size-4" />
    ))
    .with('channel_message_send', () => () => <ChatTextIcon class="size-4" />)
    .with('channel_invite', 'invite_to_team', () => () => (
      <UserPlusIcon class="size-4" />
    ))
    .with('call_started', () => () => <PhoneIcon class="size-4" />)
    .with(
      'github_pr_status_changed',
      'github_pr_check_run',
      'github_review_requested',
      'github_pr_comment',
      'github_pr_mention',
      'github_pr_review',
      () => () => <GithubIcon class="size-4" />
    )
    .with(
      P.when((value) => value?.startsWith('github_') ?? false),
      () => () => <GithubIcon class="size-4" />
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
    <span class="grid size-4 place-items-center">
      <Show
        when={props.status === 'merged'}
        fallback={
          <Show
            when={props.status === 'open' || props.status === 'closed'}
            fallback={<GithubIcon class="size-4" />}
          >
            <GitPullRequestIcon class={cn('size-4', statusClass())} />
          </Show>
        }
      >
        <GitMergeIcon class="size-4 text-note" />
      </Show>
    </span>
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

const formatDetailedTimestamp = (timestamp: string | undefined) => {
  if (!timestamp) return undefined;

  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return timestamp;

  return date.toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
};

function InboxTimestamp(props: { timestamp?: string; class?: string }) {
  const short = () =>
    props.timestamp
      ? formatCompactRelativeTimestamp(props.timestamp)
      : undefined;
  const detailed = () => formatDetailedTimestamp(props.timestamp);

  return (
    <Show when={short()}>
      {(value) => (
        <Tooltip class={props.class} label={detailed() ?? value()}>
          <span class={'whitespace-nowrap text-xs text-ink-extra-muted'}>
            {value()}
          </span>
        </Tooltip>
      )}
    </Show>
  );
}

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
    .with(
      { tag: 'github_pr_status_changed', content: { status: 'open' } },
      () => 'opened'
    )
    .with({ tag: 'github_review_requested' }, () => 'requested your review on')
    .with({ tag: 'github_pr_comment' }, () => 'commented on')
    .with({ tag: 'github_pr_mention' }, () => 'mentioned you')
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
            {props.title}
          </InboxCard.Title>
        </InboxCard.Header>

        <div class="col-start-2 row-start-2 flex min-w-0 flex-col">
          <Show when={props.preview?.trim()}>
            {(value) => (
              <InboxCard.Content class="truncate text-sm">
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
      <InboxTimestamp
        timestamp={props.timestamp}
        class="col-start-3 row-start-1 self-start justify-self-end"
      />
    </InboxCard.Root>
  );
}

const inlineWrappingMarkdownTheme = createTheme(
  {
    root: 'md inline pr-[2px] cursor-default',
    paragraph: 'md-p text-[1em] inline',
  },
  twoLineClampMarkdownTheme
);

/** Fallback shown in place of message text when a message is just attachments. */
const attachmentSummary = (count: number): string | undefined =>
  count <= 0
    ? undefined
    : `sent ${count === 1 ? 'an' : count} ${plural('attachment', count)}`;

export function ChannelCardLayout(props: InboxCardLayoutProps) {
  const entity = createMemo(() => props.item.entity);

  const messageSenderId = createMemo(() => {
    const value = props.item.entity;

    if (value.type !== 'channel') return;

    const latestSender = value.latestRootMessage?.senderId;

    return latestSender;
  });

  const messageSenderName = createSenderDisplayName(messageSenderId);

  const currentUserId = useUserId();

  const isDM = createMemo(() => {
    const value = entity();
    return value.type === 'channel' && value.channelType === 'direct_message';
  });

  const senderAvatarId = createMemo(() => {
    if (!isDM()) {
      return messageSenderId();
    }

    const value = props.item.entity;

    if (value.type !== 'channel') return;

    const participant = value.participantIds?.filter(
      (id) => id !== currentUserId()
    )[0];

    if (!participant) return;

    return participant;
  });

  const senderLabel = () => {
    if (messageSenderId() === currentUserId()) return 'You';
    return isDM() ? undefined : messageSenderName();
  };

  const text = createMemo(() => {
    const value = entity();
    const location = channelLocation(value);
    const tag = getNotificationTag(props.item.notification);

    const sender = isDM() ? value.name || messageSenderName() : '';
    let action = '';

    if (tag === 'document_mention' && isDM()) {
      action = 'shared a document with you';
    }

    const content = itemContent(value, props.item.notification);
    const latestMessage =
      value.type === 'channel' ? value.latestRootMessage : undefined;

    const contentIsAttachmentSummary = !content?.trim() && !!latestMessage;

    return {
      title: buildActionLabel({
        sender,
        action,
        location,
      }),
      content: contentIsAttachmentSummary ? attachmentSummary(1) : content,
      contentIsAttachmentSummary,
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
            <InboxCard.Icon
              fallback={<InboxAvatar senderId={senderAvatarId()} />}
            />
          }
        >
          <InboxCard.Icon
            fallback={
              <EntityIcon
                class="size-4"
                targetType={getEntityIconType(entity())}
                size="fill"
                theme="monochrome"
              />
            }
          ></InboxCard.Icon>
        </Show>
      </div>
      <InboxCard.Body class="contents">
        <InboxCard.Header class="col-start-2 row-start-1 self-center">
          <InboxCard.Title class="flex items-center gap-1">
            {text().title}
          </InboxCard.Title>
        </InboxCard.Header>

        <div class="col-start-2 row-start-2 min-w-0 text-sm">
          <InboxCard.Content class="line-clamp-2 min-h-[2lh] whitespace-normal">
            <Show when={senderLabel()}>
              <span class="whitespace-nowrap mr-1">{senderLabel()}:</span>
            </Show>

            <Show when={text().content?.trim()}>
              {(value) => (
                <>
                  <Show when={text().contentIsAttachmentSummary}>
                    <PaperclipIcon class="mr-0.5 inline size-3.5 align-[-0.125em]" />
                  </Show>
                  <StaticMarkdown
                    markdown={value()}
                    singleLine
                    theme={inlineWrappingMarkdownTheme}
                  />
                </>
              )}
            </Show>
          </InboxCard.Content>
        </div>
      </InboxCard.Body>
      <InboxTimestamp
        timestamp={props.item.timestamp}
        class="col-start-3 row-start-1 self-start justify-self-end"
      />
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
        ></InboxCard.Icon>
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

  // The root/original thread message sender (who a reply is replying to).
  const originalSenderId = () =>
    props.item.entity.type === 'channel_thread'
      ? props.item.entity.senderId
      : undefined;
  const originalSenderName = createSenderDisplayName(originalSenderId);
  const originalSenderLabel = () =>
    originalSenderId() === currentUserId() ? 'You' : originalSenderName();

  const text = createMemo(() => {
    if (props.item.entity.type !== 'channel_thread') {
      return {
        title: '',
        content: '',
        contentIsAttachmentSummary: false,
        contextIsAttachmentSummary: false,
      };
    }

    const metadata = props.item.notification?.notification_metadata;
    const location = channelLocation(props.item.entity);

    const rootAttachments = props.item.entity.attachments;

    let content: string | undefined;
    let context: string | undefined;
    let contentIsAttachmentSummary = false;
    let contextIsAttachmentSummary = false;
    if (metadata?.tag === 'channel_message_reply') {
      // Current message is the reply; the quoted context is the original (root).
      content = metadata.content.messageContent;
      if (!content.trim()) {
        const reply = props.item.entity.thread.preview.find(
          (candidate) => candidate.id === metadata.content.messageId
        );
        // Empty channel messages must contain at least one attachment. The
        // preview gives us the exact count when that reply is included.
        content = attachmentSummary(reply?.attachments.length || 1);
        contentIsAttachmentSummary = true;
      }
      const original = props.item.entity.content.trim();
      context = original.length
        ? original
        : attachmentSummary(rootAttachments.length);
      contextIsAttachmentSummary = !original.length && !!context;
    } else {
      // Root message: fall back to an attachment summary when it has no text.
      content = itemContent(props.item.entity, props.item.notification);
      if (!content?.trim()) {
        const summary = attachmentSummary(rootAttachments.length);
        content = summary ?? content;
        contentIsAttachmentSummary = !!summary;
      }
    }

    return {
      title: location,
      context,
      content,
      contentIsAttachmentSummary,
      contextIsAttachmentSummary,
    };
  });

  return (
    <InboxCard.Root
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
        ></InboxCard.Icon>
      </div>
      <InboxCard.Body class="contents">
        <div class={cn('col-start-2 row-start-2')}>
          <InboxCard.Header class="self-center">
            <InboxCard.Title class="flex items-center gap-1">
              {text().title}
            </InboxCard.Title>
          </InboxCard.Header>

          {/* For replies, show the original message being replied to first,
              with a left bar marking it as the quoted original. */}
          <div class="min-h-[2lh]">
            <Show when={isLatestNotificationReply() && text().context?.trim()}>
              {(context) => (
                <div class="flex min-w-0 items-center gap-1 border-l-2 border-edge-muted pl-2">
                  <span class="flex gap-1 items-center text-sm whitespace-nowrap text-ink-extra-muted/80 group-data-unread/inbox-item:text-ink-muted">
                    {originalSenderLabel()}:
                  </span>
                  <InboxCard.Content class="truncate text-sm text-ink/60">
                    <Show when={text().contextIsAttachmentSummary}>
                      <PaperclipIcon class="mr-0.5 inline size-3.5 align-[-0.125em]" />
                    </Show>
                    <StaticMarkdown
                      markdown={context()}
                      singleLine
                      theme={unifiedListMarkdownTheme}
                    />
                  </InboxCard.Content>
                </div>
              )}
            </Show>

            <InboxCard.Content
              class={cn(
                'text-sm text-ink/60',
                isLatestNotificationReply()
                  ? 'truncate'
                  : 'line-clamp-2 whitespace-normal'
              )}
            >
              <Show when={!isDM()}>
                <span class="mr-1 whitespace-nowrap">{senderLabel()}:</span>
              </Show>
              <Show when={text().content?.trim()}>
                {(value) => (
                  <>
                    <Show when={text().contentIsAttachmentSummary}>
                      <PaperclipIcon class="mr-0.5 inline size-3.5 align-[-0.125em]" />
                    </Show>
                    <StaticMarkdown
                      markdown={value()}
                      singleLine
                      theme={
                        isLatestNotificationReply()
                          ? unifiedListMarkdownTheme
                          : inlineWrappingMarkdownTheme
                      }
                    />
                  </>
                )}
              </Show>
            </InboxCard.Content>
          </div>
        </div>
      </InboxCard.Body>
      <InboxTimestamp
        timestamp={props.item.timestamp}
        class="col-start-3 row-start-2 self-start justify-self-end"
      />
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
        ></InboxCard.Icon>
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
                  class="size-4"
                  size="fill"
                  targetType={getEntityIconType(props.item.entity)}
                />
              }
            >
              <ActionBubble tag={getNotificationTag(props.item.notification)} />
            </Show>
          }
        ></InboxCard.Icon>
      }
      title={text().title}
      preview={text().content}
      properties={getInboxTaskProperties(props.item.entity)}
    />
  );
}

export function AiCardLayout(props: InboxCardLayoutProps) {
  const text = createMemo(() => {
    const content = itemContent(props.item.entity, props.item.notification);
    const location = entityLocation(props.item.entity);

    if (getNotificationTag(props.item.notification) !== 'ai_response') {
      return { title: props.item.entity.name, content };
    }

    return {
      title: location || props.item.entity.name,
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
                  class="size-4"
                  targetType={getEntityIconType(props.item.entity)}
                  size="fill"
                />
              }
            >
              <ActionBubble tag={getNotificationTag(props.item.notification)} />
            </Show>
          }
        ></InboxCard.Icon>
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
    const entity = props.item.entity;

    return {
      sender: senderName(),
      subject: entity.name,
      content:
        entity.type === 'email'
          ? (itemContent(entity, props.item.notification) ?? entity.snippet)
          : undefined,
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
        <InboxCard.Icon
          fallback={<ActionBubble tag="new_email" />}
        ></InboxCard.Icon>
      </div>
      <InboxCard.Body class="contents">
        <InboxCard.Header class="col-start-2 row-start-1 self-center">
          <InboxCard.Title class="flex items-center gap-1">
            {text().sender}
          </InboxCard.Title>
        </InboxCard.Header>

        <Show when={text().subject?.trim()}>
          {(subject) => (
            <InboxCard.Content class="col-start-2 row-start-2 truncate text-sm">
              {subject()}
            </InboxCard.Content>
          )}
        </Show>

        <Show when={text().content?.trim()}>
          {(value) => (
            <InboxCard.Content class="col-start-2 row-start-3 truncate text-sm">
              <StaticMarkdown
                markdown={value()}
                singleLine
                theme={unifiedListMarkdownTheme}
              />
            </InboxCard.Content>
          )}
        </Show>
      </InboxCard.Body>
      <InboxTimestamp
        timestamp={props.item.timestamp}
        class="col-start-3 row-start-1 self-start justify-self-end"
      />
    </InboxCard.Root>
  );
}

export function GithubCardLayout(props: InboxCardLayoutProps) {
  const sender = createMemo(() =>
    getGithubSender(props.item.entity, props.item.notification)
  );

  const senderId = () => sender()?.id;
  const senderFallbackName = () => sender()?.fallbackName;

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
      let action = '';
      if (hasGithubNotification) {
        sender = senderName() ?? entity.metadata.authorLogin;
        action = githubAction(props.item.notification);
      }

      return {
        title: buildActionLabel({
          sender,
          action,
        }),
        content:
          getGithubTitle(entity, props.item.notification) ||
          entity.metadata.name,
        location: githubLocation(entity),
      };
    }

    return {
      title: buildActionLabel({
        sender: senderName(),
        action: githubAction(props.item.notification),
      }),
      content: getGithubTitle(entity, props.item.notification) || entity.name,
      location: githubLocation(entity),
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
        ></InboxCard.Icon>
      </div>
      <InboxCard.Body class="contents">
        <InboxCard.Header class="col-start-2 row-start-1 self-center">
          <InboxCard.Title class="flex items-center gap-1">
            {text().title}
          </InboxCard.Title>
        </InboxCard.Header>

        <Show when={text().content?.trim()}>
          {(value) => (
            <InboxCard.Content class="col-start-2 row-start-2 truncate text-sm text-ink/60">
              <StaticMarkdown
                markdown={value()}
                singleLine
                theme={unifiedListMarkdownTheme}
              />
            </InboxCard.Content>
          )}
        </Show>

        <Show when={text().location}>
          {(location) => (
            <InboxCard.Content class="col-start-2 row-start-3 truncate text-xs text-ink/40">
              {location()}
            </InboxCard.Content>
          )}
        </Show>
      </InboxCard.Body>
      <InboxTimestamp
        timestamp={props.item.timestamp}
        class="col-start-3 row-start-1 self-start justify-self-end"
      />
    </InboxCard.Root>
  );
}

function CallParticipantName(props: { id: string }) {
  const displayName = createSenderDisplayName(() => props.id);
  return <>{displayName()}</>;
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
    const location = entityLocation(entity);

    if (getNotificationTag(props.item.notification) === 'call_started') {
      return {
        title: buildActionLabel({
          sender: senderName(),
          action: location ? 'started a call in' : 'started a call',
          location,
        }),
      };
    }

    if (entity.type === 'call' && entity.status === 'MISSED') {
      return {
        title: entity.name ? `Missed call in #${entity.name}` : 'Missed call',
      };
    }

    if (entity.type === 'call' && entity.status === 'UNATTENDED') {
      return {
        title: entity.name
          ? `Call unattended in #${entity.name}`
          : 'Call unattended',
      };
    }

    return { title: entity.name ? `Call in #${entity.name}` : 'Call' };
  });

  const participantIds = () =>
    props.item.entity.type === 'call' ? props.item.entity.participantIds : [];

  const duration = () => {
    const entity = props.item.entity;
    if (entity.type !== 'call') {
      return getNotificationTag(props.item.notification) === 'call_started'
        ? 'In progress'
        : undefined;
    }
    if (entity.durationMs != null) return formatCallDuration(entity.durationMs);
    return entity.isActive ? 'In progress' : 'No duration';
  };

  return (
    <InboxCard.Root
      dimmed={!props.item.unread}
      selected={props.selected}
      highlighted={props.highlighted}
      onClick={props.onClick}
    >
      <div class="col-start-1 row-start-1 row-span-3">
        <InboxCard.Icon
          fallback={
            <EntityIcon
              class="size-4"
              targetType="call"
              size="fill"
              theme="monochrome"
            />
          }
        ></InboxCard.Icon>
      </div>
      <InboxCard.Body class="contents">
        <InboxCard.Header class="col-start-2 row-start-1 self-center">
          <InboxCard.Title class="flex items-center gap-1">
            {text().title}
          </InboxCard.Title>
        </InboxCard.Header>

        <Show when={participantIds().length}>
          <InboxCard.Content class="col-start-2 row-start-2 truncate text-sm">
            <For each={participantIds()}>
              {(participantId, index) => (
                <>
                  {index() > 0 ? ', ' : ''}
                  <CallParticipantName id={participantId} />
                </>
              )}
            </For>
          </InboxCard.Content>
        </Show>

        <Show when={duration()}>
          {(value) => (
            <InboxCard.Content class="col-start-2 row-start-3 truncate text-sm">
              {value()}
            </InboxCard.Content>
          )}
        </Show>
      </InboxCard.Body>
      <InboxTimestamp
        timestamp={props.item.timestamp}
        class="col-start-3 row-start-1 self-start justify-self-end"
      />
    </InboxCard.Root>
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
              class="size-4"
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
