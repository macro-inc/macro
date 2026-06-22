import { useGlobalNotificationSource } from '@app/component/GlobalAppState';
import { QUERY_FILTERS_BASE } from '@app/component/next-soup/filters/query-filters';
import { EntityIcon } from '@core/component/EntityIcon';
import { StaticMarkdown } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import { unifiedListMarkdownTheme } from '@core/component/LexicalMarkdown/theme';
import { UserIcon } from '@core/component/UserIcon';
import { macroIdToEmail, tryMacroId, useDisplayName } from '@core/user';
import MacroLogo from '@icon/macro-logo.svg';
import GithubIcon from '@icon/mcp-github.svg';
import ArchiveIcon from '@phosphor-icons/core/regular/archive.svg?component-solid';
import AtIcon from '@phosphor-icons/core/regular/at.svg?component-solid';
import CaretRightIcon from '@phosphor-icons/core/regular/caret-right.svg?component-solid';
import ChatIcon from '@phosphor-icons/core/regular/chat.svg?component-solid';
import ChecksIcon from '@phosphor-icons/core/regular/checks.svg?component-solid';
import EnvelopeIcon from '@phosphor-icons/core/regular/envelope.svg?component-solid';
import FileMagnifyingGlassIcon from '@phosphor-icons/core/regular/file-magnifying-glass.svg?component-solid';
import GitMergeIcon from '@phosphor-icons/core/regular/git-merge.svg?component-solid';
import GitPullRequestIcon from '@phosphor-icons/core/regular/git-pull-request.svg?component-solid';
import { useSoupItemsQuery } from '@queries/soup/items';
import { Avatar, cn } from '@ui';
import { createMemo, createSignal, For, Match, Show, Switch } from 'solid-js';
import { PropertyPill } from '../../notification-inbox/InboxItem';
import {
  notificationAction,
  notificationContent,
  notificationSenderName,
  notificationTitle,
} from '../../notification-inbox/notification-extractors';

type LiveNotification = Parameters<typeof notificationTitle>[0];

type SoupBackedInboxItem = {
  id: string;
  entity: {
    id: string;
    type:
      | 'email'
      | 'channel_message'
      | 'document'
      | 'task'
      | 'chat'
      | 'github_pr';
    title: string;
    subtitle?: string;
    content?: string;
    sharedItemTitle?: string;
    properties?: Array<{ id: string; label: string }>;
  };
  notification: {
    tag:
      | 'new_email'
      | 'channel_message_send'
      | 'channel_mention'
      | 'channel_message_reply'
      | 'document_mention'
      | 'mentioned_in_document_comment'
      | 'replied_to_document_comment_thread'
      | 'commented_on_document'
      | 'task_assigned'
      | 'github_pr_status_changed'
      | 'github_review_requested'
      | 'github_pr_comment'
      | 'github_pr_mention'
      | 'github_pr_review'
      | 'ai_response';
    actorId?: string;
    actorName: string;
    actorKind?: 'user' | 'github' | 'macro';
    action: string;
    timestamp: string;
    unread?: boolean;
    groupKey?: string;
    github?: {
      owner: string;
      repo: string;
      number: number;
      status?: 'opened' | 'merged' | 'closed';
      branch?: string;
      checks?: 'passing' | 'failing' | 'pending';
      reviewState?: 'approved' | 'changes requested' | 'review requested';
      labels?: string[];
    };
  };
};

const items: SoupBackedInboxItem[] = [
  {
    id: 'email',
    entity: {
      id: 'email-1',
      type: 'email',
      title: 'Updated launch timeline',
      subtitle: 'jordan@example.com',
      content: 'I moved the launch review to Thursday and added notes.',
    },
    notification: {
      tag: 'new_email',
      actorName: 'Jordan Lee',
      action: 'sent you an email',
      timestamp: '10:14 AM',
      unread: true,
    },
  },
  {
    id: 'channel',
    entity: {
      id: 'message-1',
      type: 'channel_message',
      title: 'design-review',
      content: 'The grouped rows feel clearer with the count on the right.',
    },
    notification: {
      tag: 'channel_message_reply',
      actorName: 'Maya Chen',
      action: 'replied in a thread',
      timestamp: '9:42 AM',
      unread: true,
    },
  },
  {
    id: 'doc-comment',
    entity: {
      id: 'doc-1',
      type: 'document',
      title: 'Notification inbox redesign',
      subtitle: 'Comment thread',
      content: '@you can you verify the preview fallback behavior?',
    },
    notification: {
      tag: 'mentioned_in_document_comment',
      actorName: 'Alex Kim',
      action: 'mentioned you in a comment',
      timestamp: 'Yesterday',
      unread: true,
    },
  },
  {
    id: 'task',
    entity: {
      id: 'task-1',
      type: 'task',
      title: 'Wire soup-backed inbox query',
      content: 'Use soup rows with notification metadata for rendering.',
      properties: [
        { id: 'status-in-review', label: 'In review' },
        { id: 'priority-high', label: 'High' },
      ],
    },
    notification: {
      tag: 'task_assigned',
      actorName: 'Riley Chen',
      action: 'assigned this to you',
      timestamp: 'Mon',
    },
  },
  {
    id: 'channel-send',
    entity: {
      id: 'message-2',
      type: 'channel_message',
      title: 'inbox-polish',
      content: 'I pushed a few more row variants into the gallery.',
    },
    notification: {
      tag: 'channel_message_send',
      actorName: 'Noah Patel',
      action: 'sent a message',
      timestamp: '9:11 AM',
    },
  },
  {
    id: 'channel-mention',
    entity: {
      id: 'message-3',
      type: 'channel_message',
      title: 'eng-inbox',
      content: '@you do we want grouped messages to expand inline?',
    },
    notification: {
      tag: 'channel_mention',
      actorName: 'Priya Shah',
      action: 'mentioned you',
      timestamp: '9:03 AM',
      unread: true,
    },
  },
  {
    id: 'doc-reply',
    entity: {
      id: 'doc-2',
      type: 'document',
      title: 'Inbox QA checklist',
      subtitle: 'Comment thread',
      content: 'I added screenshots for the expanded group state.',
    },
    notification: {
      tag: 'replied_to_document_comment_thread',
      actorName: 'Morgan Yu',
      action: 'replied to a comment thread',
      timestamp: 'Yesterday',
    },
  },
  {
    id: 'doc-comment',
    entity: {
      id: 'doc-3',
      type: 'document',
      title: 'Notification inbox redesign',
      content:
        'I think the grouped state should read more like a thread preview.',
    },
    notification: {
      tag: 'commented_on_document',
      actorName: 'Alex Kim',
      action: 'commented on a document',
      timestamp: 'Yesterday',
    },
  },
  {
    id: 'github-status',
    entity: {
      id: 'pr-1',
      type: 'github_pr',
      title: 'Virtualize notification inbox rows',
      content: 'Status changed to merged',
    },
    notification: {
      tag: 'github_pr_status_changed',
      actorName: 'github-actions',
      actorKind: 'github',
      action: 'merged a pull request',
      timestamp: 'Fri',
      github: {
        owner: 'macro',
        repo: 'app',
        number: 4821,
        status: 'merged',
        branch: 'feature/inbox-vlist → main',
        checks: 'passing',
      },
    },
  },
  {
    id: 'github-review-requested',
    entity: {
      id: 'pr-2',
      type: 'github_pr',
      title: 'Extract notification preview adapter',
      content: 'Review requested from you',
    },
    notification: {
      tag: 'github_review_requested',
      actorName: 'devrb',
      actorKind: 'github',
      action: 'requested your review',
      timestamp: 'Thu',
      unread: true,
      github: {
        owner: 'macro',
        repo: 'app',
        number: 4822,
        reviewState: 'review requested',
        labels: ['frontend', 'notifications'],
      },
    },
  },
  {
    id: 'github-comment',
    entity: {
      id: 'pr-3',
      type: 'github_pr',
      title: 'Split virtualized rows from transform layer',
      content: 'Could we split the virtual list rows from the transform layer?',
    },
    notification: {
      tag: 'github_pr_comment',
      actorName: 'octocat',
      actorKind: 'github',
      action: 'commented on a pull request',
      timestamp: 'Thu',
      github: {
        owner: 'macro',
        repo: 'app',
        number: 4823,
        checks: 'pending',
        labels: ['refactor'],
      },
    },
  },
  {
    id: 'github-mention',
    entity: {
      id: 'pr-4',
      type: 'github_pr',
      title: 'Update inbox row layout',
      content: '@you this touches the inbox row layout you were working on.',
    },
    notification: {
      tag: 'github_pr_mention',
      actorName: 'octocat',
      actorKind: 'github',
      action: 'mentioned you on a pull request',
      timestamp: 'Wed',
      unread: true,
      github: {
        owner: 'macro',
        repo: 'app',
        number: 4824,
        branch: 'inbox-layout → main',
      },
    },
  },
  {
    id: 'github-review',
    entity: {
      id: 'pr-5',
      type: 'github_pr',
      title: 'Clean up keyboard scopes',
      content: 'Approved with a note about keyboard scope cleanup.',
    },
    notification: {
      tag: 'github_pr_review',
      actorName: 'devrb',
      actorKind: 'github',
      action: 'reviewed a pull request',
      timestamp: 'Wed',
      github: {
        owner: 'macro',
        repo: 'app',
        number: 4825,
        reviewState: 'approved',
        checks: 'passing',
      },
    },
  },
  {
    id: 'ai',
    entity: {
      id: 'chat-1',
      type: 'chat',
      title: 'Research thread',
      content: 'Summarized the relevant notification grouping behavior.',
    },
    notification: {
      tag: 'ai_response',
      actorName: 'Macro agent',
      actorKind: 'macro',
      action: 'finished a response',
      timestamp: 'Tue',
    },
  },
];

function NotificationActionMarkerContent(props: { item: SoupBackedInboxItem }) {
  const tag = () => props.item.notification.tag;
  const status = () => props.item.notification.github?.status;

  return (
    <Switch>
      <Match
        when={
          tag() === 'channel_mention' ||
          tag() === 'github_pr_mention' ||
          tag() === 'mentioned_in_document_comment'
        }
      >
        <AtIcon class="size-3.5" />
      </Match>
      <Match when={tag() === 'document_mention'}>
        <EntityIcon
          targetType={props.item.entity.type === 'task' ? 'task' : 'md'}
          size="xs"
          theme="monochrome"
        />
      </Match>
      <Match
        when={
          tag() === 'channel_message_send' || tag() === 'channel_message_reply'
        }
      >
        <ChatIcon class="size-3.5" />
      </Match>
      <Match when={tag() === 'github_review_requested'}>
        <FileMagnifyingGlassIcon class="size-3.5 text-alert-ink" />
      </Match>
      <Match when={tag() === 'github_pr_review'}>
        <ChecksIcon class="size-3.5 text-success" />
      </Match>
      <Match
        when={tag() === 'github_pr_status_changed' && status() === 'merged'}
      >
        <GitMergeIcon class="size-3.5 text-note" />
      </Match>
      <Match when={tag() === 'github_pr_status_changed'}>
        <GitPullRequestIcon
          class={cn(
            'size-3.5',
            status() === 'closed' ? 'text-failure' : 'text-success'
          )}
        />
      </Match>
      <Match when={tag() === 'ai_response'}>
        <EntityIcon targetType="chat" size="xs" theme="monochrome" />
      </Match>
    </Switch>
  );
}

function NotificationActionMarker(props: { item: SoupBackedInboxItem }) {
  return (
    <span class="absolute top-2 right-2 grid size-6 place-items-center rounded-md text-ink-extra-muted/60">
      <NotificationActionMarkerContent item={props.item} />
    </span>
  );
}

const propertyMocks: Record<string, unknown> = {
  'status-in-review': {
    propertyId: 'status-in-review',
    propertyDefinitionId: 'status-in-review',
    displayName: 'In review',
    valueType: 'SELECT_STRING',
    value: ['00000001-0000-0000-0002-000000000004'],
  },
  'priority-high': {
    propertyId: 'priority-high',
    propertyDefinitionId: 'priority-high',
    displayName: 'High',
    valueType: 'SELECT_STRING',
    value: ['00000001-0000-0000-0003-000000000003'],
  },
} as const;

function TaskPropertyPills(props: {
  properties?: SoupBackedInboxItem['entity']['properties'];
}) {
  return (
    <For each={props.properties ?? []}>
      {(property) => (
        <PropertyPill
          property={propertyMocks[property.id] as never}
          class="size-4"
        />
      )}
    </For>
  );
}

function entityIcon(type: SoupBackedInboxItem['entity']['type']) {
  return (
    <Switch>
      <Match when={type === 'email'}>
        <EnvelopeIcon class="size-4" />
      </Match>
      <Match when={type === 'channel_message'}>
        <span class="text-xs font-medium text-ink-extra-muted">#</span>
      </Match>
      <Match when={type === 'document'}>
        <EntityIcon targetType="md" size="xs" theme="monochrome" />
      </Match>
      <Match when={type === 'task'}>
        <EntityIcon targetType="task" size="xs" theme="monochrome" />
      </Match>
      <Match when={type === 'chat'}>
        <EntityIcon targetType="chat" size="xs" theme="monochrome" />
      </Match>
    </Switch>
  );
}

function ActorName(props: { item: SoupBackedInboxItem; fontMedium?: boolean }) {
  const macroId = () =>
    props.item.notification.actorId
      ? tryMacroId(props.item.notification.actorId)
      : undefined;
  const [displayName] = useDisplayName(macroId());
  const name = () => {
    if (displayName()) return displayName();
    const id = macroId();
    if (id) return macroIdToEmail(id);
    return props.item.notification.actorName;
  };

  return (
    <span
      class={cn(
        'min-w-0 truncate',
        props.fontMedium !== false && 'font-medium'
      )}
    >
      {name()}
    </span>
  );
}

function Actor(props: {
  item: SoupBackedInboxItem;
  contextBubble?: boolean;
  size?: 'sm' | 'md';
}) {
  const initials = () =>
    props.item.notification.actorName
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join('') || '?';

  return (
    <div
      class={cn('relative shrink-0', props.size === 'md' ? 'size-8' : 'size-6')}
    >
      <div
        class={cn(
          'grid size-full place-items-center overflow-hidden rounded-full bg-active text-ink-muted',
          props.size === 'md' ? 'text-xs' : 'text-[10px]'
        )}
      >
        <Switch>
          <Match when={props.item.notification.actorKind === 'macro'}>
            <MacroLogo class={props.size === 'md' ? 'size-4.5' : 'size-3.5'} />
          </Match>
          <Match when={props.item.notification.actorId}>
            {(id) => (
              <UserIcon
                id={id()}
                size="fill"
                suppressClick
                showTooltip={false}
              />
            )}
          </Match>
          <Match when={!props.item.notification.actorId}>
            <Avatar size="fill">
              <Avatar.Fallback>{initials()}</Avatar.Fallback>
            </Avatar>
          </Match>
        </Switch>
      </div>
      <Show when={props.contextBubble}>
        <div
          class={cn(
            'absolute -right-1 -bottom-1 grid place-items-center overflow-hidden rounded-full border border-surface bg-active text-ink-muted ring ring-surface',
            props.size === 'md'
              ? 'size-4 [&_svg]:size-3'
              : 'size-3.5 [&_svg]:size-2.5'
          )}
        >
          <NotificationActionMarkerContent item={props.item} />
        </div>
      </Show>
    </div>
  );
}

function ScratchMessageContent(props: { content: string }) {
  return (
    <span class="block min-w-0 overflow-hidden truncate">
      <StaticMarkdown
        markdown={props.content}
        singleLine
        theme={unifiedListMarkdownTheme}
      />
    </span>
  );
}

function formatTimeOnly(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function SoupBackedInboxRow(props: {
  item: SoupBackedInboxItem;
  nested?: boolean;
  group?: { count: number; unreadCount: number; expanded?: boolean };
}) {
  return (
    <div
      class={cn(
        'grid min-w-0 gap-2 rounded-lg p-3',
        props.group
          ? 'grid-cols-[1rem_auto_minmax(0,1fr)]'
          : 'grid-cols-[auto_minmax(0,1fr)]',
        props.nested && 'border-edge-muted/70',
        props.item.notification.unread && 'ring-1 ring-accent/30'
      )}
    >
      <Show when={props.group}>
        {(group) => (
          <span class="grid size-4 place-items-center self-center text-ink-extra-muted">
            <CaretRightIcon
              class={cn(
                'size-3 transition-transform',
                group().expanded && 'rotate-90'
              )}
            />
          </span>
        )}
      </Show>
      <Actor item={props.item} />
      <div class="flex min-w-0 flex-col gap-0.5">
        <div class="flex min-w-0 items-center gap-1 text-sm text-ink">
          <ActorName item={props.item} />
          <span class="ml-auto flex shrink-0 items-center gap-2">
            <time class="text-xs text-ink-extra-muted/60">
              {formatTimeOnly(props.item.notification.timestamp)}
            </time>
            <Show when={props.item.notification.unread}>
              <span class="size-2 shrink-0 rounded-full bg-accent" />
            </Show>
          </span>
        </div>

        <Show when={!props.nested}>
          <div class="flex min-w-0 items-center gap-1 text-sm text-ink-muted">
            <Show
              when={
                props.item.entity.type !== 'github_pr' &&
                props.item.entity.type !== 'email' &&
                props.item.entity.type !== 'channel_message'
              }
            >
              <span class="grid size-4 shrink-0 place-items-center text-ink-extra-muted">
                {entityIcon(props.item.entity.type)}
              </span>
            </Show>
            <span class="min-w-0 truncate">
              <Show when={props.item.entity.type === 'channel_message'}>#</Show>
              {props.item.entity.title}
            </span>
            <TaskPropertyPills properties={props.item.entity.properties} />
            <Show when={props.item.entity.subtitle}>
              {(subtitle) => (
                <span class="shrink-0 text-ink-extra-muted">
                  · {subtitle()}
                </span>
              )}
            </Show>
          </div>
        </Show>

        <Show when={props.item.entity.content}>
          {(content) => (
            <p class="min-w-0 truncate text-sm text-ink-muted/75">
              <ScratchMessageContent content={content()} />
            </p>
          )}
        </Show>
      </div>
    </div>
  );
}

const emailThreadGroup: SoupBackedInboxItem[] = [
  {
    id: 'email-thread-root',
    entity: {
      id: 'email-thread-1',
      type: 'email',
      title: 'Updated launch timeline',
      subtitle: 'jordan@example.com',
      content: 'I moved the launch review to Thursday and added notes.',
    },
    notification: {
      tag: 'new_email',
      actorName: 'Jordan Lee',
      action: 'sent you an email',
      timestamp: '10:14 AM',
      unread: true,
    },
  },
  {
    id: 'email-thread-reply',
    entity: {
      id: 'email-thread-2',
      type: 'email',
      title: 'Re: Updated launch timeline',
      subtitle: 'sam@example.com',
      content: 'Thursday works for me. I added the launch checklist.',
    },
    notification: {
      tag: 'new_email',
      actorName: 'Sam Rivera',
      action: 'sent you an email',
      timestamp: '10:21 AM',
      unread: true,
    },
  },
];

const githubPrGroup: SoupBackedInboxItem[] = [
  {
    id: 'github-group-root',
    entity: {
      id: 'pr-group-1',
      type: 'github_pr',
      title: 'Virtualize notification inbox rows',
      content: 'Status changed to opened',
    },
    notification: {
      tag: 'github_pr_status_changed',
      actorName: 'github-actions',
      actorKind: 'github',
      action: 'opened a pull request',
      timestamp: 'Fri',
      unread: true,
      github: { owner: 'macro', repo: 'app', number: 4821, status: 'opened' },
    },
  },
  {
    id: 'github-group-comment',
    entity: {
      id: 'pr-group-1-comment',
      type: 'github_pr',
      title: 'Virtualize notification inbox rows',
      content: 'Could we split the virtual list rows from the transform layer?',
    },
    notification: {
      tag: 'github_pr_comment',
      actorName: 'octocat',
      actorKind: 'github',
      action: 'commented on a pull request',
      timestamp: 'Thu',
      github: { owner: 'macro', repo: 'app', number: 4821 },
    },
  },
  {
    id: 'github-group-review',
    entity: {
      id: 'pr-group-1-review',
      type: 'github_pr',
      title: 'Virtualize notification inbox rows',
      content: 'Approved with a note about keyboard scope cleanup.',
    },
    notification: {
      tag: 'github_pr_review',
      actorName: 'devrb',
      actorKind: 'github',
      action: 'reviewed a pull request',
      timestamp: 'Wed',
      github: { owner: 'macro', repo: 'app', number: 4821 },
    },
  },
];

const documentCommentGroup: SoupBackedInboxItem[] = [
  {
    id: 'doc-group-root',
    entity: {
      id: 'doc-group-1',
      type: 'document',
      title: 'Notification inbox redesign',
      subtitle: 'Comment thread',
      content: '@you can you verify the preview fallback behavior?',
    },
    notification: {
      tag: 'mentioned_in_document_comment',
      actorName: 'Alex Kim',
      action: 'mentioned you in a comment',
      timestamp: 'Yesterday',
      unread: true,
    },
  },
  {
    id: 'doc-group-reply',
    entity: {
      id: 'doc-group-2',
      type: 'document',
      title: 'Notification inbox redesign',
      subtitle: 'Comment thread',
      content: 'I added screenshots for the expanded group state.',
    },
    notification: {
      tag: 'replied_to_document_comment_thread',
      actorName: 'Morgan Yu',
      action: 'replied to a comment thread',
      timestamp: 'Yesterday',
    },
  },
];

const threadGroup: SoupBackedInboxItem[] = [
  {
    id: 'thread-root',
    entity: {
      id: 'thread-root-message',
      type: 'channel_message',
      title: 'design-review',
      content: 'I think grouped channel messages should expand inline.',
    },
    notification: {
      tag: 'channel_message_send',
      actorName: 'Maya Chen',
      action: 'started a thread',
      timestamp: '11:02 AM',
      unread: true,
      groupKey: 'channel:design-review:thread-inbox-grouping',
    },
  },
  {
    id: 'thread-reply-1',
    entity: {
      id: 'thread-reply-1-message',
      type: 'channel_message',
      title: 'design-review',
      content: 'Agree. The root should summarize unread replies.',
    },
    notification: {
      tag: 'channel_message_reply',
      actorName: 'Noah Patel',
      action: 'replied in the thread',
      timestamp: '11:04 AM',
      unread: true,
      groupKey: 'channel:design-review:thread-inbox-grouping',
    },
  },
  {
    id: 'thread-reply-2',
    entity: {
      id: 'thread-reply-2-message',
      type: 'channel_message',
      title: 'design-review',
      content: 'Maybe indent replies with a subtle left rail.',
    },
    notification: {
      tag: 'channel_message_reply',
      actorName: 'Priya Shah',
      action: 'replied in the thread',
      timestamp: '11:06 AM',
      groupKey: 'channel:design-review:thread-inbox-grouping',
    },
  },
];

function getGroupKey(item: SoupBackedInboxItem) {
  if (item.entity.type === 'email') return `email:${item.entity.id}`;
  if (item.entity.type === 'channel_message') {
    return item.notification.groupKey ?? `channel:${item.entity.id}`;
  }
  if (item.entity.type === 'github_pr' && item.notification.github) {
    const github = item.notification.github;
    return `github:${github.owner}/${github.repo}#${github.number}`;
  }
  if (item.entity.type === 'document') {
    return `document:${item.entity.id}:${item.entity.subtitle ?? item.entity.title}`;
  }
  return undefined;
}

function groupConsecutiveItems(items: SoupBackedInboxItem[]) {
  const groups: SoupBackedInboxItem[][] = [];
  let currentKey: string | undefined;

  for (const item of items) {
    const key = getGroupKey(item);
    const current = groups.at(-1);

    if (key && key === currentKey && current) {
      current.push(item);
      continue;
    }

    currentKey = key;
    groups.push([item]);
  }

  return groups;
}

function GroupPreview(props: { items: SoupBackedInboxItem[] }) {
  const unreadCount = () =>
    props.items.filter((item) => item.notification.unread).length;

  return (
    <div class="flex min-w-0 flex-col gap-1.5">
      <SoupBackedInboxRow
        item={props.items[0]}
        group={{
          count: props.items.length,
          unreadCount: unreadCount(),
          expanded: true,
        }}
      />
      <div class="ml-4 flex flex-col gap-1.5 border-l border-edge-muted pl-3">
        <For each={props.items.slice(1)}>
          {(item) => <SoupBackedInboxRow item={item} nested />}
        </For>
      </div>
    </div>
  );
}

function senderDisplayName(notification: LiveNotification) {
  const name = notificationSenderName(notification);
  if (!name) return 'Unknown';

  const emailMatch = name.match(/^\"?([^\"<]+)\"?\s*</);
  return emailMatch?.[1]?.trim() || name;
}

function notificationEntityTitle(notification: LiveNotification) {
  const metadata = notification.notification_metadata;
  const content = metadata.content as unknown as Record<string, unknown>;

  if (metadata.tag === 'new_email') {
    return (
      String(content.subject ?? '') ||
      notificationTitle(notification) ||
      'Email'
    );
  }

  if (metadata.tag.startsWith('channel_')) {
    return String(content.channelName ?? '') || 'Channel';
  }

  if (metadata.tag.startsWith('github_')) {
    return (
      String(content.title ?? '') ||
      notificationTitle(notification) ||
      'Pull request'
    );
  }

  return notificationTitle(notification) || 'Unknown';
}

function useLiveSoupBackedItems() {
  const notificationSource = useGlobalNotificationSource();
  const notifications = createMemo(() =>
    notificationSource
      .notifications()
      .filter(
        (notification) =>
          !notification.deleted_at &&
          notification.notification_metadata.tag !== 'ai_response'
      )
      .slice(0, 25)
  );
  const ids = createMemo(() => {
    const values = {
      channel: [] as string[],
      chat: [] as string[],
      document: [] as string[],
      email: [] as string[],
      foreign: [] as string[],
    };

    for (const notification of notifications()) {
      const entityType = String(notification.entity_type);
      if (entityType === 'channel') values.channel.push(notification.entity_id);
      if (entityType === 'chat') values.chat.push(notification.entity_id);
      if (entityType === 'document')
        values.document.push(notification.entity_id);
      if (entityType === 'email') values.email.push(notification.entity_id);
      if (entityType === 'foreign') values.foreign.push(notification.entity_id);
    }

    return values;
  });
  const soupQuery = useSoupItemsQuery(
    () => ({
      params: { limit: 200, sort_method: 'viewed_updated' },
      body: {
        ...QUERY_FILTERS_BASE,
        channel_filters: {
          channel_ids: ids().channel.length
            ? ids().channel
            : QUERY_FILTERS_BASE.channel_filters?.channel_ids,
        },
        chat_filters: {
          chat_ids: ids().chat,
        },
        document_filters: {
          document_ids: ids().document.length
            ? ids().document
            : QUERY_FILTERS_BASE.document_filters?.document_ids,
        },
        email_filters: {
          email_thread_ids: ids().email.length
            ? ids().email
            : QUERY_FILTERS_BASE.email_filters?.email_thread_ids,
        },
        foreign_entity_filters: {
          ids: ids().foreign.length
            ? ids().foreign
            : QUERY_FILTERS_BASE.foreign_entity_filters?.ids,
        },
      },
    }),
    () => ({
      enabled: notifications().length > 0,
      showSupportedForeignEntities: true,
    })
  );

  const entityById = createMemo(
    () => new Map((soupQuery.data ?? []).map((entity) => [entity.id, entity]))
  );

  return createMemo<SoupBackedInboxItem[]>(() =>
    notifications()
      .map((notification) => {
        const entity = entityById().get(notification.entity_id) as
          | Record<string, unknown>
          | undefined;
        const metadata = notification.notification_metadata;
        const content = metadata.content as unknown as Record<string, unknown>;
        const channelGroupKey = metadata.tag.startsWith('channel_')
          ? `channel:${notification.entity_id}:${String(content.threadId ?? 'root')}`
          : undefined;
        const github = metadata.tag.startsWith('github_')
          ? {
              owner: String(content.owner ?? ''),
              repo: String(content.repo ?? ''),
              number: Number(content.number ?? 0),
              status:
                metadata.tag === 'github_pr_status_changed'
                  ? (content.status as 'opened' | 'merged' | 'closed')
                  : undefined,
            }
          : undefined;
        const actorKind: SoupBackedInboxItem['notification']['actorKind'] =
          github ? 'github' : metadata.tag === 'ai_response' ? 'macro' : 'user';

        return {
          id: notification.id,
          entity: {
            id: notification.entity_id,
            type: github
              ? 'github_pr'
              : notification.entity_type === 'channel'
                ? 'channel_message'
                : ((entity?.type ??
                    notification.entity_type) as SoupBackedInboxItem['entity']['type']),
            title:
              metadata.tag === 'new_email'
                ? String(
                    metadata.content.subject ??
                      notificationEntityTitle(
                        notification as LiveNotification
                      ) ??
                      ''
                  )
                : String(
                    entity?.name ??
                      notificationEntityTitle(notification as LiveNotification)
                  ),
            subtitle: undefined,
            sharedItemTitle:
              metadata.tag === 'document_mention'
                ? metadata.content.documentName
                : undefined,
            content:
              notificationContent(notification as LiveNotification) ||
              String(entity?.snippet ?? ''),
            properties:
              (entity?.properties as SoupBackedInboxItem['entity']['properties']) ??
              undefined,
          },
          notification: {
            tag: metadata.tag as SoupBackedInboxItem['notification']['tag'],
            actorId: notification.sender_id ?? undefined,
            actorName: senderDisplayName(notification as LiveNotification),
            actorKind,
            action:
              notificationAction(notification as LiveNotification) ?? 'updated',
            timestamp: notification.created_at ?? notification.updated_at ?? '',
            unread: !notification.viewed_at && !notification.done,
            groupKey: channelGroupKey,
            github,
          },
        };
      })
      .filter((item) => item.notification.action || item.entity.title)
  );
}

function actionLocationText(item: SoupBackedInboxItem, nested?: boolean) {
  if (
    nested ||
    item.notification.tag === 'new_email' ||
    item.entity.type === 'email'
  ) {
    return undefined;
  }
  if (item.entity.type === 'channel_message') return `#${item.entity.title}`;
  if (item.entity.type === 'github_pr' && item.notification.github) {
    const github = item.notification.github;
    return `${github.owner}/${github.repo}#${github.number}`;
  }
  return item.entity.title;
}

function actionLocationContentText(item: SoupBackedInboxItem) {
  if (item.notification.tag === 'document_mention') {
    return item.entity.sharedItemTitle ?? item.entity.title;
  }
  if (item.notification.tag === 'new_email' || item.entity.type === 'email') {
    return item.entity.title;
  }
  if (item.entity.type === 'github_pr') {
    return item.entity.title;
  }
  if (
    item.notification.tag === 'channel_mention' ||
    item.notification.tag === 'mentioned_in_document_comment' ||
    item.notification.tag === 'github_pr_mention'
  ) {
    return item.entity.content;
  }
  return item.entity.content;
}

function actionLocationActionText(item: SoupBackedInboxItem, nested?: boolean) {
  switch (item.notification.tag) {
    case 'channel_mention':
      return nested ? 'mentioned you' : 'mentioned you in';
    case 'channel_message_reply':
      return 'replied';
    case 'channel_message_send':
      return 'sent a message';
    case 'document_mention':
      return 'shared';
    case 'mentioned_in_document_comment':
      return nested ? 'mentioned you' : 'mentioned you in';
    case 'replied_to_document_comment_thread':
      return nested ? 'replied' : 'replied in';
    case 'commented_on_document':
      return 'commented on';
    case 'new_email':
      return 'sent an email';
    case 'task_assigned':
      return 'assigned you';
    case 'ai_response':
      return 'responded in';
    case 'github_review_requested':
      return 'requested your review on';
    case 'github_pr_comment':
      return 'commented on';
    case 'github_pr_mention':
      return 'mentioned you in';
    case 'github_pr_review':
      return 'reviewed';
    case 'github_pr_status_changed':
      return item.notification.github?.status === 'merged'
        ? 'merged a PR'
        : (item.notification.github?.status ?? 'updated');
    default:
      return item.notification.action;
  }
}

function SoupBackedInboxActionLocationRow(props: {
  item: SoupBackedInboxItem;
  group?: { count: number; unreadCount: number };
  groupRoot?: boolean;
  nested?: boolean;
}) {
  const groupTitle = () =>
    actionLocationText(props.item) ?? props.item.entity.title;
  const groupDescription = () => {
    const count = props.group?.count ?? 1;
    const unreadCount = props.group?.unreadCount ?? 0;
    if (unreadCount > 0) return `${unreadCount} new messages`;
    return `${count} messages`;
  };

  return (
    <div
      class={cn(
        'group/item relative grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-2 rounded-lg p-3 pr-9 opacity-75 transition-opacity hover:bg-active/50 hover:opacity-100'
      )}
    >
      <Show when={props.groupRoot} fallback={<Actor item={props.item} />}>
        <div class="grid size-6 shrink-0 place-items-center rounded-full bg-active text-ink-muted">
          <EntityIcon targetType="channel" size="xs" theme="monochrome" />
        </div>
      </Show>
      <div class="flex min-w-0 flex-col gap-0.5">
        <div class="flex min-w-0 items-center gap-1 text-sm">
          <Show
            when={props.groupRoot}
            fallback={
              <>
                <ActorName item={props.item} />
                <span class="shrink-0 text-ink-extra-muted/70">
                  {actionLocationActionText(props.item, props.nested)}
                </span>
                <Show when={actionLocationText(props.item, props.nested)}>
                  {(location) => (
                    <span class="flex min-w-0 items-center gap-1 font-medium text-ink">
                      <Show when={props.item.entity.type === 'github_pr'}>
                        <GithubIcon class="size-3.5 shrink-0 text-ink-muted" />
                      </Show>
                      <span class="min-w-0 truncate">{location()}</span>
                    </span>
                  )}
                </Show>
              </>
            }
          >
            <span class="min-w-0 truncate font-medium text-ink">
              {groupTitle()}
            </span>
          </Show>
        </div>
        <Show
          when={
            props.groupRoot
              ? groupDescription()
              : actionLocationContentText(props.item)
          }
        >
          {(content) => (
            <p class="min-w-0 truncate text-sm text-ink-muted/75">
              <ScratchMessageContent content={content()} />
            </p>
          )}
        </Show>
        <div class="mt-1.5 flex min-w-0 items-center gap-1.5">
          <Show
            when={
              props.group
                ? props.group.unreadCount > 0
                : props.item.notification.unread
            }
          >
            <span class="size-2 shrink-0 rounded-full bg-accent" />
          </Show>
          <time class="text-xs text-ink-extra-muted/60">
            {formatTimeOnly(props.item.notification.timestamp)}
          </time>
        </div>
      </div>
      <NotificationActionMarker item={props.item} />
      <button
        type="button"
        class="pointer-events-[all] absolute right-2 bottom-2 grid size-6 place-items-center rounded-md border border-edge-muted bg-surface/80 text-ink-extra-muted hover:bg-active hover:text-ink-muted"
        aria-label="Archive"
      >
        <ArchiveIcon class="size-3.5" />
      </button>
    </div>
  );
}

function ActionLocationGroupPreview(props: { items: SoupBackedInboxItem[] }) {
  const [expanded, setExpanded] = createSignal(true);
  const unreadCount = () =>
    props.items.filter((item) => item.notification.unread).length;

  return (
    <div class="flex min-w-0 flex-col gap-1.5">
      <div class="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-2">
        <button
          type="button"
          class="mt-3 grid size-6 shrink-0 place-items-center rounded-md bg-active text-ink-muted hover:bg-active-hover"
          aria-label={expanded() ? 'Collapse group' : 'Expand group'}
          aria-expanded={expanded()}
          onClick={() => setExpanded((value) => !value)}
        >
          <CaretRightIcon
            class={cn('size-3 transition-transform', expanded() && 'rotate-90')}
          />
        </button>
        <SoupBackedInboxActionLocationRow
          item={props.items[0]}
          group={{ count: props.items.length, unreadCount: unreadCount() }}
          groupRoot
        />
      </div>
      <Show when={expanded()}>
        <div class="ml-12 flex flex-col gap-1.5 border-l border-edge-muted pl-2">
          <For each={props.items}>
            {(item) => <SoupBackedInboxActionLocationRow item={item} nested />}
          </For>
        </div>
      </Show>
    </div>
  );
}

function contextBubbleMainContent(item: SoupBackedInboxItem) {
  if (item.entity.type === 'channel_message')
    return actionLocationText(item) ?? item.entity.title;
  return item.entity.title;
}

function contextBubbleActionText(item: SoupBackedInboxItem) {
  if (item.entity.type === 'channel_message') return 'sent:';
  if (item.notification.tag === 'new_email') return 'sent:';
  if (item.notification.tag === 'document_mention') return 'shared:';
  if (
    item.notification.tag === 'channel_mention' ||
    item.notification.tag === 'mentioned_in_document_comment' ||
    item.notification.tag === 'github_pr_mention'
  ) {
    return 'mentioned you:';
  }
  if (
    item.notification.tag === 'channel_message_reply' ||
    item.notification.tag === 'replied_to_document_comment_thread'
  ) {
    return 'replied:';
  }
  return `${actionLocationActionText(item)}:`;
}

function contextBubbleDetailContent(item: SoupBackedInboxItem) {
  if (item.entity.type === 'github_pr') {
    return item.entity.content ?? item.entity.title;
  }
  return (
    actionLocationContentText(item) ?? item.entity.content ?? item.entity.title
  );
}

function SoupBackedInboxContextBubbleRow(props: { item: SoupBackedInboxItem }) {
  return (
    <div class="relative grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-2 rounded-lg p-3 pr-16 hover:bg-active/50">
      <Actor item={props.item} contextBubble size="md" />
      <div class="flex min-w-0 flex-col gap-0.5">
        <div class="flex min-w-0 items-center gap-1 text-sm font-medium text-ink">
          <Show when={props.item.entity.type === 'github_pr'}>
            <GithubIcon class="size-3.5 shrink-0 text-ink-muted" />
          </Show>
          <span class="min-w-0 truncate">
            {contextBubbleMainContent(props.item)}
          </span>
        </div>
        <div class="flex min-w-0 items-center gap-1 text-sm text-ink-muted/75">
          <ActorName item={props.item} fontMedium={false} />
          <span class="shrink-0 text-ink-extra-muted/70">
            {contextBubbleActionText(props.item)}
          </span>
          <span class="min-w-0 truncate">
            <ScratchMessageContent
              content={contextBubbleDetailContent(props.item)}
            />
          </span>
        </div>
      </div>
      <time class="absolute right-3 bottom-3 text-xs text-ink-extra-muted/60">
        {formatTimeOnly(props.item.notification.timestamp)}
      </time>
    </div>
  );
}

function nonAiChatItem(item: SoupBackedInboxItem) {
  return item.notification.tag !== 'ai_response' && item.entity.type !== 'chat';
}

function TypeIconRowIcon(props: { item: SoupBackedInboxItem }) {
  return (
    <div class="grid size-8 shrink-0 place-items-center rounded-full bg-active text-ink-muted [&_svg]:size-4">
      <NotificationActionMarkerContent item={props.item} />
      <Show when={props.item.notification.tag === 'new_email'}>
        <EnvelopeIcon class="size-4" />
      </Show>
      <Show
        when={
          !props.item.notification.tag.startsWith('github_') &&
          props.item.notification.tag !== 'new_email'
        }
      >
        {entityIcon(props.item.entity.type)}
      </Show>
    </div>
  );
}

function MiniSender(props: { item: SoupBackedInboxItem }) {
  return (
    <span class="flex min-w-0 items-center gap-1 text-xs text-ink-muted/75">
      <span class="size-3.5 shrink-0 overflow-hidden rounded-full">
        <Show
          when={props.item.notification.actorId}
          fallback={
            <Avatar size="fill" class="text-[8px]">
              <Avatar.Fallback>
                {props.item.notification.actorName.slice(0, 1).toUpperCase() ||
                  '?'}
              </Avatar.Fallback>
            </Avatar>
          }
        >
          {(id) => (
            <UserIcon id={id()} size="fill" suppressClick showTooltip={false} />
          )}
        </Show>
      </span>
      <ActorName item={props.item} fontMedium={false} />
    </span>
  );
}

function SoupBackedInboxTypeIconRow(props: { item: SoupBackedInboxItem }) {
  return (
    <div class="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-2 rounded-lg p-3 hover:bg-active/50">
      <TypeIconRowIcon item={props.item} />
      <div class="flex min-w-0 flex-col gap-0.5">
        <div class="flex min-w-0 items-center gap-1">
          <MiniSender item={props.item} />
          <span class="shrink-0 text-xs text-ink-extra-muted/70">
            {actionLocationActionText(props.item)}
          </span>
        </div>
        <div class="min-w-0 truncate text-sm font-medium text-ink">
          <Show
            when={actionLocationText(props.item)}
            fallback={props.item.entity.title}
          >
            {(location) => location()}
          </Show>
        </div>
        <Show when={actionLocationContentText(props.item)}>
          {(content) => (
            <p class="min-w-0 truncate text-sm text-ink-muted/75">
              <ScratchMessageContent content={content()} />
            </p>
          )}
        </Show>
      </div>
    </div>
  );
}

function TinySenderAvatar(props: { item: SoupBackedInboxItem }) {
  const initials = () =>
    props.item.notification.actorName
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join('') || '?';

  return (
    <span class="size-4 shrink-0 overflow-hidden rounded-full bg-active text-[8px] text-ink-muted">
      <Show
        when={props.item.notification.actorId}
        fallback={
          <Avatar size="fill">
            <Avatar.Fallback>{initials()}</Avatar.Fallback>
          </Avatar>
        }
      >
        {(id) => (
          <UserIcon id={id()} size="fill" suppressClick showTooltip={false} />
        )}
      </Show>
    </span>
  );
}

function noIconThirdRowContent(item: SoupBackedInboxItem) {
  if (item.entity.type === 'channel_message') return item.entity.content;
  if (item.notification.tag === 'new_email') return item.entity.content;
  if (item.entity.type === 'github_pr') return item.entity.content;
  return undefined;
}

function NoIconContent(props: { item: SoupBackedInboxItem; content: string }) {
  return (
    <Show
      when={props.item.entity.type === 'channel_message'}
      fallback={props.content}
    >
      <StaticMarkdown
        markdown={props.content}
        theme={unifiedListMarkdownTheme}
      />
    </Show>
  );
}

function NoIconThirdRow(props: { item: SoupBackedInboxItem }) {
  const thirdRow = () => noIconThirdRowContent(props.item);

  return (
    <Show
      when={
        props.item.notification.tag === 'task_assigned' &&
        props.item.entity.properties?.length
      }
      fallback={
        <Show when={thirdRow()}>
          {(content) => (
            <div class="line-clamp-2 min-w-0 whitespace-normal text-xs text-ink-extra-muted">
              <NoIconContent item={props.item} content={content()} />
            </div>
          )}
        </Show>
      }
    >
      <div class="flex min-w-0 items-center gap-1">
        <TaskPropertyPills properties={props.item.entity.properties} />
      </div>
    </Show>
  );
}

function SoupBackedInboxNoIconRow(props: { item: SoupBackedInboxItem }) {
  const content = () =>
    actionLocationContentText(props.item) ?? props.item.entity.content;

  return (
    <div class="grid min-w-0 grid-cols-[0.5rem_minmax(0,1fr)] gap-x-2 rounded-lg p-3 hover:bg-active/50">
      <span class="mt-1.5 grid size-2 place-items-center">
        <Show when={props.item.notification.unread}>
          <span class="size-2 rounded-full bg-accent" />
        </Show>
      </span>
      <div class="flex min-w-0 flex-col gap-1">
        <div class="flex min-w-0 items-center gap-1.5 text-sm">
          <TinySenderAvatar item={props.item} />
          <ActorName item={props.item} />
          <span class="shrink-0 text-ink-extra-muted/70">
            {actionLocationActionText(props.item)}
          </span>
          <time class="ml-auto shrink-0 text-xs text-ink-extra-muted/60">
            {formatTimeOnly(props.item.notification.timestamp)}
          </time>
        </div>
        <div class="ml-[1.375rem] flex min-w-0 flex-col gap-1">
          <Show
            when={props.item.entity.type === 'channel_message'}
            fallback={
              <Show when={content()}>
                {(value) => (
                  <div class="line-clamp-2 min-w-0 whitespace-normal text-sm text-ink-muted/75">
                    <Show when={props.item.entity.type === 'github_pr'}>
                      <GithubIcon class="mr-1 inline size-3.5 text-ink-muted" />
                    </Show>
                    <NoIconContent item={props.item} content={value()} />
                  </div>
                )}
              </Show>
            }
          >
            <div class="flex min-w-0 items-center gap-1 text-sm text-ink-muted/75">
              <span class="grid size-4 shrink-0 place-items-center text-ink-extra-muted">
                #
              </span>
              <span class="min-w-0 truncate">{props.item.entity.title}</span>
            </div>
          </Show>
          <NoIconThirdRow item={props.item} />
        </div>
      </div>
    </div>
  );
}

export function SoupBackedInboxItemNoIconScratchLayout() {
  const liveItems = useLiveSoupBackedItems();

  return (
    <div class="flex min-w-0 flex-col gap-2">
      <Show
        when={liveItems().length > 0}
        fallback={
          <For each={items}>
            {(item) => <SoupBackedInboxNoIconRow item={item} />}
          </For>
        }
      >
        <For each={liveItems()}>
          {(item) => <SoupBackedInboxNoIconRow item={item} />}
        </For>
      </Show>
    </div>
  );
}

export function SoupBackedInboxItemTypeIconScratchLayout() {
  const liveItems = useLiveSoupBackedItems();

  return (
    <div class="flex min-w-0 flex-col gap-2">
      <Show
        when={liveItems().length > 0}
        fallback={
          <For each={items}>
            {(item) => <SoupBackedInboxTypeIconRow item={item} />}
          </For>
        }
      >
        <For each={liveItems()}>
          {(item) => <SoupBackedInboxTypeIconRow item={item} />}
        </For>
      </Show>
    </div>
  );
}

export function SoupBackedInboxItemContextBubbleScratchLayout() {
  const liveItems = useLiveSoupBackedItems();
  const displayItems = () => liveItems().filter(nonAiChatItem);
  const fallbackItems = items.filter(nonAiChatItem);

  return (
    <div class="flex min-w-0 flex-col gap-2">
      <Show
        when={displayItems().length > 0}
        fallback={
          <For each={fallbackItems}>
            {(item) => <SoupBackedInboxContextBubbleRow item={item} />}
          </For>
        }
      >
        <For each={displayItems()}>
          {(item) => <SoupBackedInboxContextBubbleRow item={item} />}
        </For>
      </Show>
    </div>
  );
}

export function SoupBackedInboxItemActionLocationScratchLayout() {
  const liveItems = useLiveSoupBackedItems();
  const fallbackGroups = () => groupConsecutiveItems(items);
  const liveGroups = () => groupConsecutiveItems(liveItems());

  return (
    <div class="flex min-w-0 flex-col gap-2">
      <Show
        when={liveItems().length > 0}
        fallback={<GroupedActionLocationRows groups={fallbackGroups()} />}
      >
        <GroupedActionLocationRows groups={liveGroups()} />
      </Show>
    </div>
  );
}

function GroupedActionLocationRows(props: { groups: SoupBackedInboxItem[][] }) {
  return (
    <For each={props.groups}>
      {(group) => (
        <Show
          when={group.length > 1}
          fallback={
            <div class="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-2">
              <span class="size-6 shrink-0" />
              <SoupBackedInboxActionLocationRow item={group[0]} />
            </div>
          }
        >
          <ActionLocationGroupPreview items={group} />
        </Show>
      )}
    </For>
  );
}

export function SoupBackedInboxItemScratchLayout() {
  const liveItems = useLiveSoupBackedItems();
  const liveGroups = () => groupConsecutiveItems(liveItems());

  return (
    <div class="flex min-w-0 flex-col gap-2">
      <Show
        when={liveItems().length > 0}
        fallback={
          <>
            <GroupPreview items={threadGroup} />
            <GroupPreview items={emailThreadGroup} />
            <GroupPreview items={githubPrGroup} />
            <GroupPreview items={documentCommentGroup} />
            <For each={items}>
              {(item) => <SoupBackedInboxRow item={item} />}
            </For>
          </>
        }
      >
        <For each={liveGroups()}>
          {(group) => (
            <Show
              when={group.length > 1}
              fallback={<SoupBackedInboxRow item={group[0]} />}
            >
              <GroupPreview items={group} />
            </Show>
          )}
        </For>
      </Show>
    </div>
  );
}
