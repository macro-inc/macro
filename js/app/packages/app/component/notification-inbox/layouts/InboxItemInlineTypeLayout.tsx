import {
  EntityIcon,
  type EntityIconSelector,
} from '@core/component/EntityIcon';
import { StaticMarkdown } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import { unifiedListMarkdownTheme } from '@core/component/LexicalMarkdown/theme';
import { UserIcon } from '@core/component/UserIcon';
import { MACRO_AGENT_BOT_ID } from '@core/constant/macroAgent';
import { macroIdToEmail, tryMacroId, useDisplayName } from '@core/user';
import { CallStatusBadge } from '@entity/components/Badges';
import '@app/component/next-soup/soup-view/views/tasks/list-property-value.css';
import MacroLogo from '@icon/macro-logo.svg';
import GithubIcon from '@icon/mcp-github.svg';
import CircleDashedEmpty from '@phosphor/circle-dashed.svg';
import AtIcon from '@phosphor-icons/core/regular/at.svg?component-solid';
import BellIcon from '@phosphor-icons/core/regular/bell.svg?component-solid';
import ChatIcon from '@phosphor-icons/core/regular/chat.svg?component-solid';
import EnvelopeIcon from '@phosphor-icons/core/regular/envelope.svg?component-solid';
import GitMergeIcon from '@phosphor-icons/core/regular/git-merge.svg?component-solid';
import GitPullRequestIcon from '@phosphor-icons/core/regular/git-pull-request.svg?component-solid';
import PhoneIcon from '@phosphor-icons/core/regular/phone.svg?component-solid';
import UsersIcon from '@phosphor-icons/core/regular/users.svg?component-solid';
import { Property } from '@property';
import type { Property as PropertyT } from '@property/types';
import { getEntityValues, hasValue } from '@property/utils';
import { Avatar, Dropdown, Layer } from '@ui';
import { For, Match, Show, Switch } from 'solid-js';
import { match } from 'ts-pattern';
import {
  InboxItem,
  type InboxRelatedDocument,
  PropertyPill,
  useInboxItem,
} from '../InboxItem';

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
        <span class="absolute -right-1 -bottom-1 grid size-4 place-items-center overflow-hidden rounded-full bg-surface text-ink-extra-muted ring ring-edge-muted [&_svg]:size-3">
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
  const initials = (name = fallback()) =>
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part: string) => part[0]?.toUpperCase())
      .join('') || '?';
  const channelGroupParticipants = () => {
    if (!type()?.startsWith('channel_') || !item().subItems?.length) return [];

    const participants = new Map<string, { id?: string; name?: string }>();
    for (const groupItem of [item(), ...(item().subItems ?? [])]) {
      const key = groupItem.senderId ?? groupItem.senderName;
      if (!key) continue;
      participants.set(key, {
        id: groupItem.senderId,
        name: groupItem.senderName,
      });
    }
    return [...participants.values()];
  };

  const callGroupCount = () =>
    type() === 'call_started' || type() === 'call-started'
      ? (item().callStatuses?.length ?? 0)
      : 0;

  return (
    <InboxItem.Icon class="size-9 self-center">
      <span class="relative size-9 shrink-0">
        <Show
          when={channelGroupParticipants().length >= 2 || callGroupCount() >= 2}
          fallback={
            <span class="grid size-full place-items-center overflow-hidden rounded-full bg-active text-ink-muted">
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
                <MacroLogo class="size-5" />
              </Show>
            </span>
          }
        >
          <div class="flex size-full items-center justify-center -space-x-3">
            <Show
              when={callGroupCount() >= 2}
              fallback={
                <For each={channelGroupParticipants().slice(0, 1)}>
                  {(participant) => (
                    <span class="grid size-6 shrink-0 place-items-center overflow-hidden rounded-full bg-active text-xs text-ink-muted ring ring-surface">
                      <Show
                        when={participant.id}
                        fallback={<span>{initials(participant.name)}</span>}
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
                  )}
                </For>
              }
            >
              <span class="grid size-6 shrink-0 place-items-center overflow-hidden rounded-full bg-active text-ink-muted ring ring-surface">
                <PhoneIcon class="size-3.5" />
              </span>
            </Show>
            <Show
              when={
                channelGroupParticipants().length > 2 || callGroupCount() > 1
              }
            >
              <span class="z-10 grid aspect-square size-6 shrink-0 place-items-center rounded-full bg-ink-muted text-xs font-medium leading-none text-surface ring ring-surface">
                +
                {callGroupCount() >= 2
                  ? callGroupCount() - 1
                  : channelGroupParticipants().length - 1}
              </span>
            </Show>
          </div>
        </Show>
        <Show
          when={channelGroupParticipants().length < 2 && callGroupCount() < 2}
        >
          <NotificationBadge />
        </Show>
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
  type: string | undefined,
  subType?: string
): EntityIconSelector | undefined {
  if (type === 'channel_message') return 'channel';
  if (type === 'document') return subType === 'task' ? 'task' : 'md';
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
      () => (
        <EntityIcon
          targetType={item().entitySubType === 'task' ? 'task' : 'md'}
          class="size-3.5 shrink-0"
        />
      )
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
    .with('call_started', 'call-started', () => (
      <PhoneIcon class="size-3.5 shrink-0 text-ink-muted" />
    ))
    .otherwise(() =>
      fallbackEntityIconType(item().entityType, item().entitySubType) ? (
        <EntityIcon
          targetType={fallbackEntityIconType(
            item().entityType,
            item().entitySubType
          )}
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
  const rawDocumentMentionChannelName = () => {
    const metadata = item().notification?.notification_metadata;
    if (metadata?.tag !== 'document_mention') return undefined;
    return String(metadata.content.channelName || '') || undefined;
  };
  const channelMacroId = () => {
    const value = rawDocumentMentionChannelName();
    return value ? tryMacroId(value) : undefined;
  };
  const [channelDisplayName] = useDisplayName(channelMacroId());
  const documentMentionChannelName = () => {
    const id = channelMacroId();
    if (!id) return rawDocumentMentionChannelName();
    return channelDisplayName() || macroIdToEmail(id);
  };
  const displayTitle = () => {
    if (type() === 'new_email') return subject() || title();
    if (type() === 'document_mention')
      return documentMentionChannelName() || title();
    return title();
  };

  return (
    <div class="flex min-w-0 items-center gap-1 text-sm text-ink-muted">
      <Show when={type() === 'document_mention'} fallback={<EntityTypeIcon />}>
        <span class="size-3.5 shrink-0">
          <EntityIcon targetType="channel" size="fill" />
        </span>
      </Show>
      <span class="min-w-0 truncate">{displayTitle()}</span>
    </div>
  );
}

function groupedActionText() {
  const { item } = useInboxItem();
  const type = useNotificationType();

  return () => {
    if (!item().subItems?.length) return undefined;

    const count = item().subItems?.length ?? 0;
    const unreadCount =
      item().subItems?.filter((subItem) => subItem.unread).length ?? 0;

    if (type() === 'call_started' || type() === 'call-started') {
      return `${item().callStatuses?.length ?? count} calls`;
    }

    if (type()?.startsWith('channel_')) {
      const metadata = item().notification?.notification_metadata;
      const content = metadata?.content as
        | { threadId?: string | null }
        | undefined;
      const label =
        unreadCount > 0 ? `${unreadCount} new messages` : `${count} messages`;

      if (content?.threadId) return `${label} in thread`;
      return label;
    }

    if (
      type() === 'mentioned_in_document_comment' ||
      type() === 'replied_to_document_comment_thread' ||
      type() === 'commented_on_document'
    ) {
      const label =
        unreadCount > 0 ? `${unreadCount} new comments` : `${count} comments`;
      return `${label} in thread`;
    }

    return undefined;
  };
}

function callStatus() {
  const { item } = useInboxItem();

  return () => {
    const entity = item().previewEntity;
    return entity?.type === 'call' ? entity.status : undefined;
  };
}

function callGroupStats() {
  const { item } = useInboxItem();

  return () => {
    const statuses = item().callStatuses;
    if (!statuses || statuses.length < 2) return undefined;

    const counts = new Map<string, number>();
    for (const status of statuses) {
      counts.set(status, (counts.get(status) ?? 0) + 1);
    }

    const parts = [
      ['MISSED', 'missed'],
      ['UNATTENDED', 'unattended'],
      ['ATTENDED', 'attended'],
    ]
      .map(([status, label]) => {
        const count = counts.get(status);
        return count ? `${count} ${label}` : undefined;
      })
      .filter(Boolean);

    return parts.join(', ') || undefined;
  };
}

function actionText() {
  const { item } = useInboxItem();
  const type = useNotificationType();
  const groupText = groupedActionText();

  return () => {
    if (groupText()) return groupText();
    if (type() === 'document_mention') return 'shared a document with you';
    if (type() === 'call_started' || type() === 'call-started') return 'called';
    if (type() === 'ai_response') return 'responded';
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

function TaskListPropertyValue(props: { property: PropertyT }) {
  const isUserEntity = () =>
    props.property.valueType === 'ENTITY' &&
    props.property.specificEntityType === 'USER';
  const userCount = () =>
    isUserEntity() ? getEntityValues(props.property).length : 0;
  const isEmpty = () => !hasValue(props.property);

  return (
    <Property.Root property={props.property} canEdit={false}>
      <Property.Tooltip property={props.property}>
        <Layer depth={2}>
          <Property.EditTrigger class="list-property-cell inline-flex min-w-0 items-center gap-1.5 rounded-full bg-surface/50 px-2 py-1.5 text-left text-xs leading-tight ring ring-edge ring-inset">
            <Show
              when={!isEmpty()}
              fallback={
                <>
                  <CircleDashedEmpty class="size-3 shrink-0 opacity-50" />
                  <span class="min-w-0 flex-1 truncate opacity-50">
                    {props.property.displayName}
                  </span>
                </>
              }
            >
              <Switch
                fallback={
                  <Property.Icon
                    property={props.property}
                    class="size-3 shrink-0"
                  />
                }
              >
                <Match when={userCount() > 1}>
                  <Property.UserStack property={props.property} maxUsers={2} />
                </Match>
                <Match when={isUserEntity()}>
                  <Property.Icon property={props.property} class="size-5" />
                </Match>
              </Switch>
              <Property.Text property={props.property} class="min-w-0 flex-1" />
            </Show>
            <Property.Caret class="@max-[840px]/u-list:hidden" />
          </Property.EditTrigger>
        </Layer>
      </Property.Tooltip>
    </Property.Root>
  );
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

function documentIconTarget(document: {
  fileType?: string;
  subType?: string;
}): EntityIconSelector {
  if (document.subType === 'task') return 'task';
  if (document.fileType === 'canvas') return 'canvas';
  return 'md';
}

function RelatedDocumentSenderName(props: { senderName?: string }) {
  const macroId = () =>
    props.senderName ? tryMacroId(props.senderName) : undefined;
  const [displayName] = useDisplayName(macroId());
  const name = () => {
    const id = macroId();
    if (!id) return props.senderName;
    return displayName() || macroIdToEmail(id);
  };

  return (
    <Show when={name()}>
      {(senderName) => (
        <span class="min-w-0 truncate text-xs text-ink-extra-muted">
          {senderName()}
        </span>
      )}
    </Show>
  );
}

function RelatedDocumentPill(props: { document: InboxRelatedDocument }) {
  return (
    <span class="inline-flex min-w-0 items-center gap-1 rounded-full bg-surface/50 px-2 py-1 text-xs text-ink-muted ring ring-edge ring-inset">
      <EntityIcon
        targetType={documentIconTarget(props.document)}
        class="size-3.5 shrink-0"
      />
      <span class="min-w-0 truncate">{props.document.name}</span>
    </span>
  );
}

function RelatedDocuments(props: {
  onSelectDocument?: (document: InboxRelatedDocument) => void;
}) {
  const { item } = useInboxItem();
  const documents = () => item().relatedDocuments ?? [];
  const [first, ...rest] = documents();

  return (
    <Show when={first}>
      {(document) => (
        <div class="flex min-w-0 items-center gap-1">
          <RelatedDocumentPill document={document()} />
          <Show when={rest.length > 0}>
            <Dropdown placement="bottom-start" gutter={4}>
              <Dropdown.Trigger class="h-6 rounded-full bg-surface/50 px-2 text-xs text-ink-muted ring ring-edge ring-inset">
                {rest.length} more
              </Dropdown.Trigger>
              <Dropdown.Content>
                <Dropdown.Group>
                  <For each={rest}>
                    {(document) => (
                      <Dropdown.Item
                        class="flex h-fit max-w-64 cursor-default items-start gap-1.5 px-2.5 py-1.5 text-sm text-ink-muted outline-none hover:bg-hover"
                        onSelect={() => props.onSelectDocument?.(document)}
                      >
                        <EntityIcon
                          targetType={documentIconTarget(document)}
                          class="mt-0.5 size-3.5 shrink-0"
                        />
                        <span class="flex min-w-0 flex-col">
                          <span class="min-w-0 truncate">{document.name}</span>
                          <RelatedDocumentSenderName
                            senderName={document.senderName}
                          />
                        </span>
                      </Dropdown.Item>
                    )}
                  </For>
                </Dropdown.Group>
              </Dropdown.Content>
            </Dropdown>
          </Show>
        </div>
      )}
    </Show>
  );
}

function Description(props: {
  onSelectRelatedDocument?: (document: InboxRelatedDocument) => void;
}) {
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
  const documentMentionDescription = () => {
    const metadata = item().notification?.notification_metadata;
    if (metadata?.tag !== 'document_mention') return undefined;

    const documentName = String(metadata.content.documentName || '');
    const messageContent = String(metadata.content.messageContent || '');

    if (documentName && messageContent)
      return `${documentName} — ${messageContent}`;
    return documentName || messageContent || undefined;
  };
  const status = callStatus();
  const callStats = callGroupStats();
  const documentMentionFileType = () => {
    const previewEntity = item().previewEntity;
    return previewEntity?.type === 'document'
      ? previewEntity.fileType
      : undefined;
  };
  const groupText = groupedActionText();
  const description = () => {
    if (groupText()) return callStats();
    if (type() === 'document_mention') return documentMentionDescription();
    if (type() === 'call_started' || type() === 'call-started') {
      return status();
    }
    return unreadGroupDescription() || groupedDescription();
  };
  const showTaskProperties = () =>
    type() === 'task_assigned' && Boolean(item().properties?.length);
  const showRelatedDocuments = () =>
    type()?.startsWith('channel_') && Boolean(item().relatedDocuments?.length);
  const nonCallDescription = () => {
    if (type() === 'call_started' || type() === 'call-started')
      return undefined;
    return description();
  };

  return (
    <Show
      when={description() || showTaskProperties() || showRelatedDocuments()}
    >
      <div class="flex min-w-0 items-center gap-1 truncate text-sm text-ink-muted/75">
        <Show when={showTaskProperties()}>
          <For each={item().properties ?? []}>
            {(property) => <TaskListPropertyValue property={property} />}
          </For>
        </Show>
        <Show when={showRelatedDocuments()}>
          <RelatedDocuments onSelectDocument={props.onSelectRelatedDocument} />
        </Show>
        <Show when={type() === 'call_started' || type() === 'call-started'}>
          <Show
            when={callStats()}
            fallback={
              <Show when={status()}>
                {(status) => <CallStatusBadge status={status()} />}
              </Show>
            }
          >
            {(stats) => (
              <span class="min-w-0 truncate text-sm text-ink-muted/75">
                {stats()}
              </span>
            )}
          </Show>
        </Show>
        <Show when={nonCallDescription()}>
          {(content) => (
            <>
              <Show when={type() === 'document_mention'}>
                <EntityIcon
                  targetType={documentIconTarget({
                    fileType: documentMentionFileType(),
                    subType: item().entitySubType,
                  })}
                  class="size-3.5 shrink-0"
                />
              </Show>
              <ContentText content={content()} />
            </>
          )}
        </Show>
      </div>
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
  const groupText = groupedActionText();

  return (
    <div class="flex min-w-0 items-center gap-1 text-xs text-ink-extra-muted/70">
      <Show
        when={!groupText() && (item().senderName || item().senderId)}
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
      <Show
        when={
          item().notification?.notification_metadata.tag !== 'task_assigned'
        }
      >
        <For each={item().properties ?? []}>
          {(property) => <PropertyPill property={property} />}
        </For>
      </Show>
    </div>
  );
}

function TimestampColumn() {
  const { item } = useInboxItem();

  return (
    <div class="flex h-full flex-col items-end pt-0.5">
      <Show when={item().timestamp}>
        {(timestamp) => (
          <InboxItem.Timestamp>{timestamp()}</InboxItem.Timestamp>
        )}
      </Show>
    </div>
  );
}

export function InboxItemInlineTypeLayout(
  props: {
    onClick?: (event: MouseEvent) => void;
    onSelectRelatedDocument?: (document: InboxRelatedDocument) => void;
  } = {}
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
              <Description
                onSelectRelatedDocument={props.onSelectRelatedDocument}
              />
            </div>
          </div>
          <TimestampColumn />
        </div>
      </InboxItem.Body>
    </InboxItem.Content>
  );
}
