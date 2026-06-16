import {
  EntityIcon,
  type EntityIconSelector,
} from '@core/component/EntityIcon';
import GithubIcon from '@icon/mcp-github.svg';
import UsersIcon from '@phosphor/users.svg';
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
import { match, P } from 'ts-pattern';
import { InboxItem, PropertyPill, useInboxItem } from '../InboxItem';

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
        <XCircleIcon class={`${iconClass()} text-failure`} />
      </Match>
      <Match when={status() === 'merged'}>
        <GitMergeIcon class={`${iconClass()} text-note`} />
      </Match>
    </Switch>
  );
}

function NotificationIconFrame(props: {
  icon: JSX.Element;
  badge?: JSX.Element;
}) {
  return (
    <Layer depth={2}>
      <span class="relative grid size-8 place-items-center rounded-xl bg-active p-1 text-ink-muted">
        {props.icon}
        <Show when={props.badge}>
          {(badge) => (
            <Layer depth={5}>
              <span class="absolute -right-1 -bottom-1 grid size-4 place-items-center rounded-full bg-active text-ink-muted ring ring-surface">
                {badge()}
              </span>
            </Layer>
          )}
        </Show>
      </span>
    </Layer>
  );
}

function EntityNotificationIcon(props: {
  targetType: EntityIconSelector;
  badge?: JSX.Element;
}) {
  return (
    <NotificationIconFrame
      badge={props.badge}
      icon={
        <div class="size-4">
          <EntityIcon targetType={props.targetType} size="fill" />
        </div>
      }
    />
  );
}

function NotificationIcon() {
  const type = useNotificationType();

  return match(type())
    .with('new_email', () => <EntityNotificationIcon targetType="email" />)
    .with('channel_mention', () => (
      <EntityNotificationIcon
        badge={<AtIcon class="size-3" />}
        targetType="channel"
      />
    ))
    .with('channel_message_send', 'channel_message_reply', () => (
      <EntityNotificationIcon
        badge={<ChatIcon class="size-3" />}
        targetType="channel"
      />
    ))
    .with('channel_invite', () => (
      <EntityNotificationIcon
        badge={<UserPlusIcon class="size-3" />}
        targetType="channel"
      />
    ))
    .with('invite_to_team', () => (
      <NotificationIconFrame
        badge={<UserPlusIcon class="size-3" />}
        icon={<UsersIcon class="size-4" />}
      />
    ))
    .with('document_mention', 'mentioned_in_document_comment', () => (
      <EntityNotificationIcon
        badge={<AtIcon class="size-3" />}
        targetType="md"
      />
    ))
    .with('replied_to_document_comment_thread', 'commented_on_document', () => (
      <EntityNotificationIcon
        badge={<ChatIcon class="size-3" />}
        targetType="md"
      />
    ))
    .with('task_assigned', () => (
      <EntityNotificationIcon
        badge={<UserPlusIcon class="size-3" />}
        targetType="task"
      />
    ))
    .with('ai_response', () => (
      <NotificationIconFrame icon={<RobotIcon class="size-4" />} />
    ))
    .with('github_pr_status_changed', () => (
      <NotificationIconFrame
        badge={<GithubStatusIcon class="size-3" />}
        icon={<GithubIcon class="size-5 text-ink-muted" />}
      />
    ))
    .with('github_review_requested', () => (
      <NotificationIconFrame
        badge={<FileMagnifyingGlassIcon class="size-3 text-alert-ink" />}
        icon={<GithubIcon class="size-5 text-ink-muted" />}
      />
    ))
    .with('github_pr_comment', () => (
      <NotificationIconFrame
        badge={<ChatIcon class="size-3" />}
        icon={<GithubIcon class="size-5 text-ink-muted" />}
      />
    ))
    .with('github_pr_mention', () => (
      <NotificationIconFrame
        badge={<AtIcon class="size-3" />}
        icon={<GithubIcon class="size-5 text-ink-muted" />}
      />
    ))
    .with('github_pr_review', () => (
      <NotificationIconFrame
        badge={<ChecksIcon class="size-3 text-success" />}
        icon={<GithubIcon class="size-5 text-ink-muted" />}
      />
    ))
    .with('call-started', () => (
      <NotificationIconFrame icon={<PhoneIcon class="size-4" />} />
    ))
    .otherwise(() => (
      <NotificationIconFrame icon={<BellIcon class="size-4" />} />
    ));
}

function useNotificationType() {
  const { item } = useInboxItem();

  return () => item().notification?.notification_metadata.tag;
}

function notificationTitleContext(item: InboxItem): string | undefined {
  const metadata = item.notification?.notification_metadata;
  if (!metadata) return undefined;

  return match(metadata)
    .with(
      {
        tag: P.union(
          'channel_mention',
          'channel_message_send',
          'channel_message_reply'
        ),
      },
      (metadata) => String(metadata.content.channelName)
    )
    .with({ tag: 'invite_to_team' }, (metadata) =>
      String(metadata.content.teamName)
    )
    .with(
      {
        tag: P.union(
          'github_review_requested',
          'github_pr_comment',
          'github_pr_mention',
          'github_pr_review'
        ),
      },
      (metadata) =>
        `${String(metadata.content.owner)}/${String(metadata.content.repo)}#${String(metadata.content.number)}`
    )
    .otherwise(() => undefined);
}

function notificationTitleContextHref(item: InboxItem) {
  const metadata = item.notification?.notification_metadata;
  if (!metadata) return undefined;

  return match(metadata)
    .with(
      {
        tag: P.union(
          'github_review_requested',
          'github_pr_comment',
          'github_pr_mention',
          'github_pr_review'
        ),
      },
      (metadata) =>
        `https://github.com/${String(metadata.content.owner)}/${String(metadata.content.repo)}/pull/${String(metadata.content.number)}`
    )
    .otherwise(() => undefined);
}

function NotificationTitle(props: {
  title?: string;
  context?: string;
  contextHref?: string;
}) {
  const { item } = useInboxItem();
  const title = () => {
    if (props.title) return props.title;
    const current = item();
    return current.targetName || current.entityName;
  };
  const context = () => props.context;

  return (
    <InboxItem.Header>
      <span class="min-w-0 truncate text-sm text-ink">{title()}</span>
      <Show when={context()}>
        {(value) => (
          <Show
            when={props.contextHref}
            fallback={
              <span class="shrink-0 text-xs text-ink-muted/70">{value()}</span>
            }
          >
            {(href) => (
              <InboxItem.Link class="shrink-0" href={href()}>
                {value()}
              </InboxItem.Link>
            )}
          </Show>
        )}
      </Show>
    </InboxItem.Header>
  );
}

function NotificationDescription(props: { avatar?: boolean } = {}) {
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
                  <Show when={item().action}>
                    {(action) => <> {action()}</>}
                  </Show>
                </span>
              }
            >
              <span class="contents">
                <InboxItem.Sender class="font-normal text-ink-muted/85" />
                <Show when={item().action}>
                  {(action) => (
                    <span class="shrink-0 text-xs text-ink-muted/85">
                      {action()}
                    </span>
                  )}
                </Show>
              </span>
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

type StandardLayoutProps = {
  icon?: JSX.Element;
  title?: string;
  contextHref?: string;
  description?: JSX.Element;
  descriptionAvatar?: boolean;
  actions?: JSX.Element;
  onClick?: (event: MouseEvent) => void;
};

function StandardLayout(props: StandardLayoutProps) {
  const { item } = useInboxItem();
  const type = useNotificationType();

  const context = () => notificationTitleContext(item());

  const contextHref = () => {
    if (props.contextHref) return props.contextHref;
    return notificationTitleContextHref(item());
  };

  const title = () => {
    if (props.title) return props.title;

    const current = item();
    if (current.targetName || current.entityName) {
      return current.targetName ?? current.entityName;
    }

    return match(type())
      .with('ai_response', () => 'AI response')
      .otherwise(() => undefined);
  };

  const descriptionAvatar = () => {
    if (props.descriptionAvatar) return props.descriptionAvatar;

    return !match(type())
      .with('ai_response', 'call-started', () => true)
      .otherwise(() => false);
  };

  return (
    <>
      <InboxItem.Content onClick={props.onClick}>
        <InboxItem.Icon class="size-8">
          {props.icon ?? <NotificationIcon />}
        </InboxItem.Icon>
        <InboxItem.Body>
          <NotificationTitle
            title={title()}
            context={context()}
            contextHref={contextHref()}
          />
          <Show
            when={props.description}
            fallback={<NotificationDescription avatar={descriptionAvatar()} />}
          >
            {(description) => description()}
          </Show>
        </InboxItem.Body>
      </InboxItem.Content>
      <Show when={props.actions}>
        {(actions) => <InboxItem.ActionsRow>{actions()}</InboxItem.ActionsRow>}
      </Show>
    </>
  );
}

function GithubStatusContextLine() {
  const { item } = useInboxItem();
  const prNumber = () => {
    const metadata = item().notification?.notification_metadata;
    if (metadata?.tag !== 'github_pr_status_changed') return undefined;
    return `#${metadata.content.number}`;
  };
  const action = () => {
    if (item().action) return item().action;
    const metadata = item().notification?.notification_metadata;
    if (metadata?.tag !== 'github_pr_status_changed') return 'opened';
    if (metadata.content.status === 'merged') return 'merged';
    if (metadata.content.status === 'closed') return 'closed';
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
            {(_senderName) => (
              <span class="contents">
                <InboxItem.Sender class="font-normal text-ink-muted/85" />
                <span class="shrink-0 text-xs text-ink-muted/85">
                  {action()}
                </span>
              </span>
            )}
          </Show>
          <InboxItem.Link>{number()}</InboxItem.Link>
        </InboxItem.Description>
      )}
    </Show>
  );
}

export function InboxItemLayout(
  props: { onClick?: (event: MouseEvent) => void } = {}
) {
  const { item } = useInboxItem();
  const type = useNotificationType();

  return (
    <Switch fallback={<StandardLayout onClick={props.onClick} />}>
      <Match when={type() === 'channel_invite'}>
        <StandardLayout
          onClick={props.onClick}
          actions={<InboxItem.ActionButton>Accept</InboxItem.ActionButton>}
        />
      </Match>
      <Match when={type() === 'invite_to_team'}>
        <StandardLayout
          onClick={props.onClick}
          actions={<InboxItem.ActionButton>Accept</InboxItem.ActionButton>}
        />
      </Match>
      <Match when={type() === 'task_assigned'}>
        <StandardLayout
          onClick={props.onClick}
          description={
            <InboxItem.Description density="compact" timestamp={false}>
              <Show when={item().senderName}>
                {(_senderName) => (
                  <span class="contents">
                    <InboxItem.Sender class="font-normal text-ink-muted/85" />
                    <Show when={item().action}>
                      {(action) => (
                        <span class="shrink-0 text-xs text-ink-muted/85">
                          {action()}
                        </span>
                      )}
                    </Show>
                  </span>
                )}
              </Show>
              <span class="ml-auto flex shrink-0 items-center gap-1">
                <For each={item().properties ?? []}>
                  {(property) => (
                    <PropertyPill property={property} density="compact" />
                  )}
                </For>
                <Show
                  when={item().subItems?.length}
                  fallback={
                    <Show when={item().timestamp}>
                      {(timestamp) => (
                        <InboxItem.Timestamp>{timestamp()}</InboxItem.Timestamp>
                      )}
                    </Show>
                  }
                >
                  {(count) => (
                    <Layer depth={5}>
                      <span class="grid h-4 min-w-4 place-items-center rounded-md bg-active px-1 text-xs text-ink-muted">
                        {count()}
                      </span>
                    </Layer>
                  )}
                </Show>
              </span>
            </InboxItem.Description>
          }
        />
      </Match>
      <Match when={type() === 'github_pr_status_changed'}>
        <StandardLayout
          description={<GithubStatusContextLine />}
          onClick={props.onClick}
        />
      </Match>
      <Match when={type() === 'call-started'}>
        <StandardLayout
          onClick={props.onClick}
          actions={<InboxItem.ActionButton>Join</InboxItem.ActionButton>}
          descriptionAvatar={false}
        />
      </Match>
    </Switch>
  );
}
