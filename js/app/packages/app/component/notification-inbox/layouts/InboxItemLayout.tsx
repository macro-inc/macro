import { EntityIcon } from '@core/component/EntityIcon';
import GithubIcon from '@icon/mcp-github.svg';
import AtIcon from '@phosphor-icons/core/regular/at.svg?component-solid';
import BellIcon from '@phosphor-icons/core/regular/bell.svg?component-solid';
import ChatIcon from '@phosphor-icons/core/regular/chat.svg?component-solid';
import ChecksIcon from '@phosphor-icons/core/regular/checks.svg?component-solid';
import FileMagnifyingGlassIcon from '@phosphor-icons/core/regular/file-magnifying-glass.svg?component-solid';
import GitMergeIcon from '@phosphor-icons/core/regular/git-merge.svg?component-solid';
import GitPullRequestIcon from '@phosphor-icons/core/regular/git-pull-request.svg?component-solid';
import PhoneIcon from '@phosphor-icons/core/regular/phone.svg?component-solid';
import RobotIcon from '@phosphor-icons/core/regular/robot.svg?component-solid';
import UserPlusIcon from '@phosphor-icons/core/regular/user-plus.svg?component-solid';
import XCircleIcon from '@phosphor-icons/core/regular/x-circle.svg?component-solid';
import { Layer } from '@ui';
import { For, type JSX, Match, Show, Switch } from 'solid-js';
import { InboxItem, PropertyPill, useInboxItem } from '../InboxItem';

function GithubStatusIcon(props: { class?: string } = {}) {
  const { item } = useInboxItem();
  const status = () => item().githubStatus;
  const iconClass = () => props.class ?? 'size-4';

  return (
    <Switch
      fallback={<GitPullRequestIcon class={`${iconClass()} text-success`} />}
    >
      <Match when={status() === 'closed'}>
        <XCircleIcon class={`${iconClass()} text-failure`} />
      </Match>
      <Match when={status() === 'merged'}>
        <GitMergeIcon class={`${iconClass()} text-note`} />
      </Match>
    </Switch>
  );
}

function GithubNotificationIcon(props: { badge: JSX.Element }) {
  return (
    <Layer depth={2}>
      <span class="relative grid size-8 place-items-center rounded-xl bg-active p-1 text-ink-muted">
        <GithubIcon class="size-6 text-ink-muted" />
        <span class="absolute -right-1 -bottom-1 grid size-4 place-items-center rounded-full bg-active text-ink-muted ring ring-surface">
          {props.badge}
        </span>
      </span>
    </Layer>
  );
}

function TaskAssignedIcon() {
  return (
    <Layer depth={2}>
      <span class="relative grid size-8 place-items-center rounded-xl bg-active p-1 text-ink-muted">
        <div class="size-4">
          <EntityIcon targetType="task" size="fill" />
        </div>
        <Layer depth={5}>
          <span class="absolute -right-1 -bottom-1 grid size-4 place-items-center rounded-full bg-active text-ink-muted ring ring-surface">
            <UserPlusIcon class="size-3" />
          </span>
        </Layer>
      </span>
    </Layer>
  );
}

function DocumentNotificationIcon(props: { badge: JSX.Element }) {
  return (
    <Layer depth={2}>
      <span class="relative grid size-8 place-items-center rounded-xl bg-active p-1 text-ink-muted">
        <EntityIcon targetType="md" class="size-4" />
        <Layer depth={5}>
          <span class="absolute -right-1 -bottom-1 grid size-4 place-items-center rounded-full bg-active text-ink-muted ring ring-surface">
            {props.badge}
          </span>
        </Layer>
      </span>
    </Layer>
  );
}

function ChannelNotificationIcon(props: { badge: JSX.Element }) {
  return (
    <Layer depth={2}>
      <span class="relative grid size-8 place-items-center rounded-xl bg-active p-1 text-ink-muted">
        <div class="size-4">
          <EntityIcon targetType="channel" size="fill" />
        </div>
        <Layer depth={5}>
          <span class="absolute -right-1 -bottom-1 grid size-4 place-items-center rounded-full bg-active text-ink-muted ring ring-surface">
            {props.badge}
          </span>
        </Layer>
      </span>
    </Layer>
  );
}

function SimpleNotificationIcon(props: { children: JSX.Element }) {
  return (
    <Layer depth={2}>
      <span class="grid size-8 place-items-center rounded-xl bg-active p-1 text-ink-muted">
        {props.children}
      </span>
    </Layer>
  );
}

function EmailNotificationIcon() {
  return (
    <SimpleNotificationIcon>
      <div class="size-4">
        <EntityIcon targetType="email" size="fill" />
      </div>
    </SimpleNotificationIcon>
  );
}

function GithubSummary(props: { context?: boolean } = {}) {
  const { item } = useInboxItem();

  return (
    <InboxItem.Header>
      <span class="min-w-0 truncate text-sm text-ink">
        {item().targetName ?? item().entityName}
      </span>
      <Show when={props.context && item().context}>
        {(context) => (
          <InboxItem.Link class="shrink-0">{context()}</InboxItem.Link>
        )}
      </Show>
    </InboxItem.Header>
  );
}

function ActorDescriptionLine(props: { avatar?: boolean } = {}) {
  const { item } = useInboxItem();
  const showAvatar = () => props.avatar ?? true;

  return (
    <Show when={item().senderName || item().action || item().content}>
      <InboxItem.Description>
        <Show
          when={item().senderName}
          fallback={
            <Show when={item().action}>
              {(action) => (
                <span class="shrink-0 text-xs text-ink-muted">{action()}</span>
              )}
            </Show>
          }
        >
          {(senderName) => (
            <Show
              when={showAvatar()}
              fallback={
                <span class="min-w-0 shrink-0 truncate text-xs text-ink-muted/85">
                  {senderName()}
                </span>
              }
            >
              <InboxItem.Sender class="font-normal text-ink-muted/85">
                {senderName()}
                {/* <Show when={item().action}>{(action) => <> {action()}</>}</Show> */}
              </InboxItem.Sender>
            </Show>
          )}
        </Show>
        <Show when={item().content}>
          {(content) => (
            <span class="min-w-0 truncate text-xs text-ink-muted/70">
              {content()}
            </span>
          )}
        </Show>
      </InboxItem.Description>
    </Show>
  );
}

function GithubStatusContextLine() {
  const { item } = useInboxItem();
  const prNumber = () => {
    const context = item().context;
    if (!context) return undefined;
    return context.includes('#')
      ? context.slice(context.lastIndexOf('#'))
      : context;
  };
  const action = () => {
    if (item().action) return item().action;
    if (item().githubStatus === 'merged') return 'merged';
    if (item().githubStatus === 'closed') return 'closed';
    return 'opened';
  };

  return (
    <Show when={prNumber()}>
      {(number) => (
        <InboxItem.Description>
          <Show
            when={item().senderName}
            fallback={
              <span class="shrink-0 text-xs text-ink-muted">{action()}</span>
            }
          >
            {(senderName) => (
              <InboxItem.Sender class="font-normal text-ink-muted/85">
                {senderName()} {action()}
              </InboxItem.Sender>
            )}
          </Show>
          <InboxItem.Link>{number()}</InboxItem.Link>
        </InboxItem.Description>
      )}
    </Show>
  );
}

export function EmailNotificationLayout() {
  const { item } = useInboxItem();

  return (
    <InboxItem.Content>
      <InboxItem.Icon class="size-8">
        <EmailNotificationIcon />
      </InboxItem.Icon>
      <InboxItem.Body>
        <InboxItem.Header>
          <span class="min-w-0 truncate text-sm text-ink">
            {item().targetName ?? item().entityName}
          </span>
        </InboxItem.Header>
        <ActorDescriptionLine />
      </InboxItem.Body>
    </InboxItem.Content>
  );
}

export function ChannelMentionNotificationLayout() {
  const { item } = useInboxItem();

  return (
    <InboxItem.Content>
      <InboxItem.Icon class="size-8">
        <ChannelNotificationIcon badge={<AtIcon class="size-3" />} />
      </InboxItem.Icon>
      <InboxItem.Body>
        <InboxItem.Header>
          <span class="min-w-0 truncate text-sm text-ink">
            {item().targetName ?? item().entityName}
          </span>
          <Show when={item().context}>
            {(context) => (
              <span class="shrink-0 text-xs text-ink-muted/70">
                {context()}
              </span>
            )}
          </Show>
        </InboxItem.Header>
        <ActorDescriptionLine />
      </InboxItem.Body>
    </InboxItem.Content>
  );
}

export function ChannelMessageSendNotificationLayout() {
  const { item } = useInboxItem();

  return (
    <InboxItem.Content>
      <InboxItem.Icon class="size-8">
        <ChannelNotificationIcon badge={<ChatIcon class="size-3" />} />
      </InboxItem.Icon>
      <InboxItem.Body>
        <InboxItem.Header>
          <span class="min-w-0 truncate text-sm text-ink">
            {item().targetName ?? item().entityName}
          </span>
          <Show when={item().context}>
            {(context) => (
              <span class="shrink-0 text-xs text-ink-muted/70">
                {context()}
              </span>
            )}
          </Show>
        </InboxItem.Header>
        <ActorDescriptionLine />
      </InboxItem.Body>
    </InboxItem.Content>
  );
}

export function ChannelMessageReplyNotificationLayout() {
  const { item } = useInboxItem();

  return (
    <InboxItem.Content>
      <InboxItem.Icon class="size-8">
        <ChannelNotificationIcon badge={<ChatIcon class="size-3" />} />
      </InboxItem.Icon>
      <InboxItem.Body>
        <InboxItem.Header>
          <span class="min-w-0 truncate text-sm text-ink">
            {item().targetName ?? item().entityName}
          </span>
          <Show when={item().context}>
            {(context) => (
              <span class="shrink-0 text-xs text-ink-muted/70">
                {context()}
              </span>
            )}
          </Show>
        </InboxItem.Header>
        <ActorDescriptionLine />
      </InboxItem.Body>
    </InboxItem.Content>
  );
}

export function ChannelInviteNotificationLayout() {
  const { item } = useInboxItem();

  return (
    <>
      <InboxItem.Content>
        <InboxItem.Icon class="size-8">
          <ChannelNotificationIcon badge={<UserPlusIcon class="size-3" />} />
        </InboxItem.Icon>
        <InboxItem.Body>
          <InboxItem.Header>
            <span class="min-w-0 truncate text-sm text-ink">
              {item().targetName ?? item().entityName}
            </span>
          </InboxItem.Header>
          <ActorDescriptionLine />
        </InboxItem.Body>
      </InboxItem.Content>
      <InboxItem.ActionsRow>
        <InboxItem.ActionButton>Accept</InboxItem.ActionButton>
      </InboxItem.ActionsRow>
    </>
  );
}

export function TeamInviteNotificationLayout() {
  const { item } = useInboxItem();

  return (
    <>
      <InboxItem.Content>
        <InboxItem.Icon class="size-8">
          <SimpleNotificationIcon>
            <UserPlusIcon class="size-4" />
          </SimpleNotificationIcon>
        </InboxItem.Icon>
        <InboxItem.Body>
          <InboxItem.Header>
            <span class="min-w-0 truncate text-sm text-ink">
              {item().targetName ?? item().entityName}
            </span>
          </InboxItem.Header>
          <ActorDescriptionLine />
        </InboxItem.Body>
      </InboxItem.Content>
      <InboxItem.ActionsRow>
        <InboxItem.ActionButton>Accept</InboxItem.ActionButton>
      </InboxItem.ActionsRow>
    </>
  );
}

export function DocumentMentionNotificationLayout() {
  const { item } = useInboxItem();

  return (
    <InboxItem.Content>
      <InboxItem.Icon class="size-8">
        <DocumentNotificationIcon badge={<AtIcon class="size-3" />} />
      </InboxItem.Icon>
      <InboxItem.Body>
        <InboxItem.Header>
          <span class="min-w-0 truncate text-sm text-ink">
            {item().targetName ?? item().entityName}
          </span>
        </InboxItem.Header>
        <ActorDescriptionLine />
      </InboxItem.Body>
    </InboxItem.Content>
  );
}

export function DocumentCommentMentionNotificationLayout() {
  const { item } = useInboxItem();

  return (
    <InboxItem.Content>
      <InboxItem.Icon class="size-8">
        <DocumentNotificationIcon badge={<AtIcon class="size-3" />} />
      </InboxItem.Icon>
      <InboxItem.Body>
        <InboxItem.Header>
          <span class="min-w-0 truncate text-sm text-ink">
            {item().targetName ?? item().entityName}
          </span>
          <Show when={item().context}>
            {(context) => (
              <span class="shrink-0 text-xs text-ink-muted/70">
                {context()}
              </span>
            )}
          </Show>
        </InboxItem.Header>
        <ActorDescriptionLine />
      </InboxItem.Body>
    </InboxItem.Content>
  );
}

export function DocumentCommentReplyNotificationLayout() {
  const { item } = useInboxItem();

  return (
    <InboxItem.Content>
      <InboxItem.Icon class="size-8">
        <DocumentNotificationIcon badge={<ChatIcon class="size-3" />} />
      </InboxItem.Icon>
      <InboxItem.Body>
        <InboxItem.Header>
          <span class="min-w-0 truncate text-sm text-ink">
            {item().targetName ?? item().entityName}
          </span>
          <Show when={item().context}>
            {(context) => (
              <span class="shrink-0 text-xs text-ink-muted/70">
                {context()}
              </span>
            )}
          </Show>
        </InboxItem.Header>
        <ActorDescriptionLine />
      </InboxItem.Body>
    </InboxItem.Content>
  );
}

export function DocumentCommentNotificationLayout() {
  const { item } = useInboxItem();

  return (
    <InboxItem.Content>
      <InboxItem.Icon class="size-8">
        <DocumentNotificationIcon badge={<ChatIcon class="size-3" />} />
      </InboxItem.Icon>
      <InboxItem.Body>
        <InboxItem.Header>
          <span class="min-w-0 truncate text-sm text-ink">
            {item().targetName ?? item().entityName}
          </span>
          <Show when={item().context}>
            {(context) => (
              <span class="shrink-0 text-xs text-ink-muted/70">
                {context()}
              </span>
            )}
          </Show>
        </InboxItem.Header>
        <ActorDescriptionLine />
      </InboxItem.Body>
    </InboxItem.Content>
  );
}

export function TaskAssignedNotificationLayout() {
  const { item } = useInboxItem();

  return (
    <InboxItem.Content>
      <InboxItem.Icon class="size-8">
        <TaskAssignedIcon />
      </InboxItem.Icon>
      <InboxItem.Body>
        <InboxItem.Header>
          <span class="min-w-0 truncate text-sm text-ink">
            {item().targetName ?? item().entityName}
          </span>
        </InboxItem.Header>
        <InboxItem.Description density="compact" timestamp={false}>
          <Show when={item().senderName}>
            {(senderName) => (
              <InboxItem.Sender class="font-normal text-ink-muted/85">
                {senderName()}
                <Show when={item().action}>{(action) => <> {action()}</>}</Show>
              </InboxItem.Sender>
            )}
          </Show>
          <span class="ml-auto flex shrink-0 items-center gap-1">
            <For each={item().properties ?? []}>
              {(property) => (
                <PropertyPill property={property} density="compact" />
              )}
            </For>
            <Show when={item().timestamp}>
              {(timestamp) => (
                <InboxItem.Timestamp>{timestamp()}</InboxItem.Timestamp>
              )}
            </Show>
          </span>
        </InboxItem.Description>
      </InboxItem.Body>
    </InboxItem.Content>
  );
}

export function AiResponseNotificationLayout() {
  const { item } = useInboxItem();

  return (
    <InboxItem.Content>
      <InboxItem.Icon class="size-8">
        <SimpleNotificationIcon>
          <RobotIcon class="size-4" />
        </SimpleNotificationIcon>
      </InboxItem.Icon>
      <InboxItem.Body>
        <InboxItem.Header>
          <span class="min-w-0 truncate text-sm text-ink">
            {item().targetName ?? item().entityName ?? 'AI response'}
          </span>
        </InboxItem.Header>
        <ActorDescriptionLine avatar={false} />
      </InboxItem.Body>
    </InboxItem.Content>
  );
}

export function GithubPrStatusChangedNotificationLayout() {
  const { item } = useInboxItem();

  return (
    <InboxItem.Content>
      <InboxItem.Icon>
        <GithubNotificationIcon badge={<GithubStatusIcon class="size-3" />} />
      </InboxItem.Icon>
      <InboxItem.Body>
        <InboxItem.Header>
          <span class="min-w-0 truncate text-sm text-ink">
            {item().targetName ?? item().entityName}
          </span>
        </InboxItem.Header>
        <GithubStatusContextLine />
      </InboxItem.Body>
    </InboxItem.Content>
  );
}

export function GithubReviewRequestedNotificationLayout() {
  return (
    <InboxItem.Content>
      <InboxItem.Icon>
        <GithubNotificationIcon
          badge={<FileMagnifyingGlassIcon class="size-3 text-alert-ink" />}
        />
      </InboxItem.Icon>
      <InboxItem.Body>
        <GithubSummary context />
        <ActorDescriptionLine />
      </InboxItem.Body>
    </InboxItem.Content>
  );
}

export function GithubPrCommentNotificationLayout() {
  return (
    <InboxItem.Content>
      <InboxItem.Icon>
        <GithubNotificationIcon badge={<ChatIcon class="size-3" />} />
      </InboxItem.Icon>
      <InboxItem.Body>
        <GithubSummary context />
        <ActorDescriptionLine />
      </InboxItem.Body>
    </InboxItem.Content>
  );
}

export function GithubPrMentionNotificationLayout() {
  return (
    <InboxItem.Content>
      <InboxItem.Icon>
        <GithubNotificationIcon badge={<AtIcon class="size-3" />} />
      </InboxItem.Icon>
      <InboxItem.Body>
        <GithubSummary context />
        <ActorDescriptionLine />
      </InboxItem.Body>
    </InboxItem.Content>
  );
}

export function GithubPrReviewNotificationLayout() {
  return (
    <InboxItem.Content>
      <InboxItem.Icon>
        <GithubNotificationIcon
          badge={<ChecksIcon class="size-3 text-success" />}
        />
      </InboxItem.Icon>
      <InboxItem.Body>
        <GithubSummary context />
        <ActorDescriptionLine />
      </InboxItem.Body>
    </InboxItem.Content>
  );
}

export function CallStartedNotificationLayout() {
  const { item } = useInboxItem();

  return (
    <>
      <InboxItem.Content>
        <InboxItem.Icon class="size-8">
          <SimpleNotificationIcon>
            <PhoneIcon class="size-4" />
          </SimpleNotificationIcon>
        </InboxItem.Icon>
        <InboxItem.Body>
          <InboxItem.Header>
            <span class="min-w-0 truncate text-sm text-ink">
              {item().targetName ?? item().entityName}
            </span>
          </InboxItem.Header>
          <ActorDescriptionLine avatar={false} />
        </InboxItem.Body>
      </InboxItem.Content>
      <InboxItem.ActionsRow>
        <InboxItem.ActionButton>Join</InboxItem.ActionButton>
      </InboxItem.ActionsRow>
    </>
  );
}

export function UnknownNotificationLayout() {
  const { item } = useInboxItem();

  return (
    <InboxItem.Content>
      <InboxItem.Icon>
        <BellIcon class="size-4" />
      </InboxItem.Icon>
      <InboxItem.Body>
        <InboxItem.Header>
          <span class="min-w-0 truncate text-sm text-ink">
            {item().targetName ?? item().entityName}
          </span>
        </InboxItem.Header>
        <ActorDescriptionLine />
      </InboxItem.Body>
    </InboxItem.Content>
  );
}

export function InboxItemLayout() {
  const { item } = useInboxItem();
  const notificationType = () => item().notificationType;

  return (
    <Switch fallback={<UnknownNotificationLayout />}>
      <Match when={notificationType() === 'new_email'}>
        <EmailNotificationLayout />
      </Match>
      <Match when={notificationType() === 'channel_mention'}>
        <ChannelMentionNotificationLayout />
      </Match>
      <Match when={notificationType() === 'channel_message_send'}>
        <ChannelMessageSendNotificationLayout />
      </Match>
      <Match when={notificationType() === 'channel_message_reply'}>
        <ChannelMessageReplyNotificationLayout />
      </Match>
      <Match when={notificationType() === 'channel_invite'}>
        <ChannelInviteNotificationLayout />
      </Match>
      <Match when={notificationType() === 'invite_to_team'}>
        <TeamInviteNotificationLayout />
      </Match>
      <Match when={notificationType() === 'document_mention'}>
        <DocumentMentionNotificationLayout />
      </Match>
      <Match when={notificationType() === 'mentioned_in_document_comment'}>
        <DocumentCommentMentionNotificationLayout />
      </Match>
      <Match when={notificationType() === 'replied_to_document_comment_thread'}>
        <DocumentCommentReplyNotificationLayout />
      </Match>
      <Match when={notificationType() === 'commented_on_document'}>
        <DocumentCommentNotificationLayout />
      </Match>
      <Match when={notificationType() === 'task_assigned'}>
        <TaskAssignedNotificationLayout />
      </Match>
      <Match when={notificationType() === 'ai_response'}>
        <AiResponseNotificationLayout />
      </Match>
      <Match when={notificationType() === 'github_pr_status_changed'}>
        <GithubPrStatusChangedNotificationLayout />
      </Match>
      <Match when={notificationType() === 'github_review_requested'}>
        <GithubReviewRequestedNotificationLayout />
      </Match>
      <Match when={notificationType() === 'github_pr_comment'}>
        <GithubPrCommentNotificationLayout />
      </Match>
      <Match when={notificationType() === 'github_pr_mention'}>
        <GithubPrMentionNotificationLayout />
      </Match>
      <Match when={notificationType() === 'github_pr_review'}>
        <GithubPrReviewNotificationLayout />
      </Match>
      <Match when={notificationType() === 'call-started'}>
        <CallStartedNotificationLayout />
      </Match>
    </Switch>
  );
}
