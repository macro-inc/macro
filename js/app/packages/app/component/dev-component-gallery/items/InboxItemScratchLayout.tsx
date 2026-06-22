import { EntityIcon } from '@core/component/EntityIcon';
import MacroLogo from '@icon/macro-logo.svg';
import GithubIcon from '@icon/mcp-github.svg';
import AtIcon from '@phosphor-icons/core/regular/at.svg?component-solid';
import ChatIcon from '@phosphor-icons/core/regular/chat.svg?component-solid';
import CheckSquareIcon from '@phosphor-icons/core/regular/check-square.svg?component-solid';
import ChecksIcon from '@phosphor-icons/core/regular/checks.svg?component-solid';
import EnvelopeIcon from '@phosphor-icons/core/regular/envelope.svg?component-solid';
import FileMagnifyingGlassIcon from '@phosphor-icons/core/regular/file-magnifying-glass.svg?component-solid';
import GitMergeIcon from '@phosphor-icons/core/regular/git-merge.svg?component-solid';
import GitPullRequestIcon from '@phosphor-icons/core/regular/git-pull-request.svg?component-solid';
import PhoneIcon from '@phosphor-icons/core/regular/phone.svg?component-solid';
import UsersIcon from '@phosphor-icons/core/regular/users.svg?component-solid';
import XCircleIcon from '@phosphor-icons/core/regular/x-circle.svg?component-solid';
import { Avatar, cn } from '@ui';
import { For, Match, Show, Switch } from 'solid-js';

type ScratchInboxItem = {
  id: string;
  actor: string;
  avatar?: 'initials' | 'macro' | 'github';
  action: string;
  location: string;
  context?: string;
  contextHref?: string;
  contextBadge?: boolean;
  content?: string;
  timestamp: string;
  unread?: boolean;
  icon?:
    | 'chat'
    | 'agent-chat'
    | 'github'
    | 'github-opened'
    | 'github-merged'
    | 'github-closed'
    | 'github-review-requested'
    | 'github-reviewed'
    | 'email'
    | 'people'
    | 'task'
    | 'phone'
    | 'mention';
};

const items: ScratchInboxItem[] = [
  {
    id: 'new-email',
    actor: 'Jordan Lee',
    avatar: 'initials',
    action: 'sent you an email',
    location: 'Q2 planning notes',
    content: 'Following up with the updated timeline and open questions.',
    timestamp: '9:58 AM',
    unread: true,
    icon: 'email',
  },
  {
    id: 'channel-message-send',
    actor: 'Maya Chen',
    avatar: 'initials',
    action: 'sent a message',
    location: '#product-design',
    content: 'Can you take a look at the inbox row treatment before standup?',
    timestamp: '9:42 AM',
    unread: true,
    icon: 'chat',
  },
  {
    id: 'channel-mention',
    actor: 'Noah Patel',
    avatar: 'initials',
    action: 'mentioned you',
    location: '#eng-inbox',
    content: '@you do we want grouped messages to expand inline?',
    timestamp: '9:15 AM',
    unread: true,
    icon: 'mention',
  },
  {
    id: 'channel-message-reply',
    actor: 'Priya Shah',
    avatar: 'initials',
    action: 'replied in a thread',
    location: '#design-review',
    content: 'Agree, the timestamp column should stay visually quiet.',
    timestamp: '8:51 AM',
    icon: 'chat',
  },
  {
    id: 'channel-invite',
    actor: 'Sam Rivera',
    avatar: 'initials',
    action: 'started a conversation',
    location: 'Inbox polish',
    timestamp: '8:32 AM',
    icon: 'people',
  },
  {
    id: 'invite-to-team',
    actor: 'Casey Morgan',
    avatar: 'initials',
    action: 'invited you to join',
    location: 'Design Systems',
    timestamp: 'Yesterday',
    icon: 'people',
  },
  {
    id: 'document-mention',
    actor: 'Alex Kim',
    avatar: 'initials',
    action: 'mentioned you in a document',
    location: 'Notification inbox redesign',
    content: 'Please review the grouping section when you get a chance.',
    timestamp: 'Yesterday',
    unread: true,
    icon: 'mention',
  },
  {
    id: 'mentioned-in-document-comment',
    actor: 'Taylor Brooks',
    avatar: 'initials',
    action: 'mentioned you in a comment',
    location: 'Inbox QA checklist',
    content: '@you can you confirm the read/unread states?',
    timestamp: 'Yesterday',
  },
  {
    id: 'replied-to-document-comment-thread',
    actor: 'Morgan Yu',
    avatar: 'initials',
    action: 'replied to a comment thread',
    location: 'Notification inbox redesign',
    content: 'I added screenshots for the expanded group state.',
    timestamp: 'Mon',
  },
  {
    id: 'commented-on-document',
    actor: 'Alex Kim',
    avatar: 'initials',
    action: 'commented on a document',
    location: 'Notification inbox redesign',
    content:
      'I think the grouped state should read more like a thread preview.',
    timestamp: 'Mon',
  },
  {
    id: 'task-assigned',
    actor: 'Riley Chen',
    avatar: 'initials',
    action: 'assigned this to you',
    location: 'Polish notification keyboard navigation',
    content: 'Priority: High · Status: In review',
    timestamp: 'Fri',
    unread: true,
    icon: 'task',
  },
  {
    id: 'github-pr-opened',
    actor: 'github-actions',
    avatar: 'github',
    action: 'opened a pull request',
    location: 'Add virtualized notification inbox rows',
    context: 'macro/app#4821',
    contextHref: 'https://github.com/macro/app/pull/4821',
    contextBadge: true,
    content: 'Status changed to opened',
    timestamp: 'Fri',
    icon: 'github-opened',
  },
  {
    id: 'github-pr-merged',
    actor: 'github-actions',
    avatar: 'github',
    action: 'merged a pull request',
    location: 'Ship notification preview fallback',
    context: 'macro/app#4819',
    contextHref: 'https://github.com/macro/app/pull/4819',
    contextBadge: true,
    content: 'Status changed to merged',
    timestamp: 'Fri',
    icon: 'github-merged',
  },
  {
    id: 'github-pr-closed',
    actor: 'github-actions',
    avatar: 'github',
    action: 'closed a pull request',
    location: 'Try alternate inbox density',
    context: 'macro/app#4818',
    contextHref: 'https://github.com/macro/app/pull/4818',
    contextBadge: true,
    content: 'Status changed to closed',
    timestamp: 'Fri',
    icon: 'github-closed',
  },
  {
    id: 'github-review-requested',
    actor: 'devrb',
    avatar: 'github',
    action: 'requested your review',
    location: 'Refactor notification preview adapters',
    context: 'macro/app#4822',
    content: 'Review requested from you',
    timestamp: 'Thu',
    unread: true,
    icon: 'github-review-requested',
  },
  {
    id: 'github-pr-comment',
    actor: 'octocat',
    avatar: 'github',
    action: 'commented on a pull request',
    location: 'Split virtualized rows from transform layer',
    context: 'macro/app#4823',
    content: 'Could we split the virtual list rows from the transform layer?',
    timestamp: 'Thu',
    icon: 'github',
  },
  {
    id: 'github-pr-mention',
    actor: 'octocat',
    avatar: 'github',
    action: 'mentioned you on a pull request',
    location: 'Update inbox row layout',
    context: 'macro/app#4824',
    content: '@you this touches the inbox row layout you were working on.',
    timestamp: 'Wed',
    icon: 'mention',
  },
  {
    id: 'github-pr-review',
    actor: 'devrb',
    avatar: 'github',
    action: 'reviewed a pull request',
    location: 'Clean up keyboard scopes',
    context: 'macro/app#4825',
    contextHref: 'https://github.com/macro/app/pull/4825',
    contextBadge: true,
    content: 'Approved with a note about keyboard scope cleanup.',
    timestamp: 'Wed',
    icon: 'github-reviewed',
  },
  {
    id: 'ai-response',
    actor: 'Macro agent',
    avatar: 'macro',
    action: 'finished a response',
    location: 'Research thread',
    content: 'Summarized the relevant notification grouping behavior.',
    timestamp: 'Tue',
    icon: 'agent-chat',
  },
  {
    id: 'call-started',
    actor: 'Elena Park',
    avatar: 'initials',
    action: 'started a call',
    location: 'Design sync',
    timestamp: 'Tue',
    unread: true,
    icon: 'phone',
  },
];

function ActorAvatar(props: { item: ScratchInboxItem }) {
  const initials = () =>
    props.item.actor
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join('') || '?';

  return (
    <div class="relative size-9 shrink-0 overflow-hidden rounded-full bg-active text-ink-muted">
      <Show
        when={props.item.avatar === 'macro'}
        fallback={
          <Show
            when={props.item.avatar === 'github'}
            fallback={
              <Avatar size="fill">
                <Avatar.Fallback>{initials()}</Avatar.Fallback>
              </Avatar>
            }
          >
            <div class="grid size-full place-items-center bg-ink text-surface">
              <GithubIcon class="size-6" />
            </div>
          </Show>
        }
      >
        <div class="grid size-full place-items-center bg-accent/10">
          <MacroLogo class="size-5" />
        </div>
      </Show>
    </div>
  );
}

function LocationIcon(props: { type?: ScratchInboxItem['icon'] }) {
  return (
    <Show when={props.type}>
      <span class="grid size-4 shrink-0 place-items-center text-ink-extra-muted">
        <Switch>
          <Match when={props.type === 'chat'}>
            <ChatIcon class="size-4" />
          </Match>
          <Match when={props.type === 'agent-chat'}>
            <EntityIcon targetType="chat" size="xs" theme="monochrome" />
          </Match>
          <Match when={props.type === 'github'}>
            <GithubIcon class="size-4" />
          </Match>
          <Match when={props.type === 'github-opened'}>
            <GitPullRequestIcon class="size-4 text-success" />
          </Match>
          <Match when={props.type === 'github-merged'}>
            <GitMergeIcon class="size-4 text-note" />
          </Match>
          <Match when={props.type === 'github-closed'}>
            <XCircleIcon class="size-4 text-failure" />
          </Match>
          <Match when={props.type === 'github-review-requested'}>
            <FileMagnifyingGlassIcon class="size-4 text-alert-ink" />
          </Match>
          <Match when={props.type === 'github-reviewed'}>
            <ChecksIcon class="size-4 text-success" />
          </Match>
          <Match when={props.type === 'email'}>
            <EnvelopeIcon class="size-4" />
          </Match>
          <Match when={props.type === 'people'}>
            <UsersIcon class="size-4" />
          </Match>
          <Match when={props.type === 'task'}>
            <CheckSquareIcon class="size-4" />
          </Match>
          <Match when={props.type === 'phone'}>
            <PhoneIcon class="size-4" />
          </Match>
          <Match when={props.type === 'mention'}>
            <AtIcon class="size-4" />
          </Match>
        </Switch>
      </span>
    </Show>
  );
}

function shouldShowIconInActionRow(type?: ScratchInboxItem['icon']) {
  return (
    type === 'chat' ||
    type === 'mention' ||
    type === 'github-opened' ||
    type === 'github-merged' ||
    type === 'github-closed' ||
    type === 'github-review-requested' ||
    type === 'github-reviewed'
  );
}

function ScratchInboxRow(props: { item: ScratchInboxItem }) {
  const actionRowIcon = () =>
    shouldShowIconInActionRow(props.item.icon) ? props.item.icon : undefined;
  const locationRowIcon = () =>
    shouldShowIconInActionRow(props.item.icon) ? undefined : props.item.icon;

  return (
    <div
      class={cn(
        'grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-3 rounded-lg border border-edge-muted bg-surface p-3',
        props.item.unread && 'ring-1 ring-accent/30'
      )}
    >
      <ActorAvatar item={props.item} />
      <div class="flex min-w-0 flex-col gap-2">
        <div class="flex min-w-0 items-center gap-1 text-xs text-ink-extra-muted/70">
          <Show when={props.item.unread}>
            <span class="size-2 shrink-0 rounded-full bg-accent" />
          </Show>
          <span class="min-w-0 truncate font-medium">{props.item.actor}</span>
          <LocationIcon type={actionRowIcon()} />
          <span class="min-w-0 truncate">{props.item.action}</span>
          <time class="ml-auto shrink-0 text-ink-extra-muted/60">
            {props.item.timestamp}
          </time>
        </div>
        <div class="flex min-w-0 flex-col gap-1">
          <div class="flex min-w-0 items-center gap-1 text-sm text-ink-muted">
            <LocationIcon type={locationRowIcon()} />
            <span class="min-w-0 truncate">{props.item.location}</span>
            <Show when={!props.item.contextBadge && props.item.context}>
              {(context) => (
                <span class="shrink-0 text-ink-extra-muted">· {context()}</span>
              )}
            </Show>
          </div>
          <Show
            when={props.item.contextBadge && props.item.context}
            fallback={
              <Show when={props.item.content}>
                {(content) => (
                  <p class="min-w-0 truncate text-sm text-ink-muted/75">
                    {content()}
                  </p>
                )}
              </Show>
            }
          >
            {(context) => (
              <a
                class="inline-flex w-fit items-center gap-1 rounded-full border border-edge-muted px-1.5 py-0.5 text-xs text-ink-extra-muted transition-colors hover:border-edge hover:bg-hover hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                href={props.item.contextHref}
                rel="noreferrer"
                target="_blank"
              >
                <GithubIcon class="size-3" />
                {context()}
              </a>
            )}
          </Show>
        </div>
      </div>
    </div>
  );
}

export function InboxItemScratchLayout() {
  return (
    <div class="flex min-w-0 flex-col gap-2">
      <For each={items}>{(item) => <ScratchInboxRow item={item} />}</For>
    </div>
  );
}
