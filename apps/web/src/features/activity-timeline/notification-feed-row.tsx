import { globalSplitManager } from '@app/signal/splitLayout';
import { UserIcon } from '@core/component/UserIcon';
import { tryMacroId, useDisplayName } from '@core/user';
import {
  getGithubSenderAvatarUrl,
  getGithubSenderLogin,
  isGithubNotificationType,
} from '@entity/extractors-notification/notification-description-helpers';
import { NotificationIcon } from '@entity/extractors-notification/notification-icon';
import { openNotification, type UnifiedNotification } from '@notifications';
import { Avatar } from '@ui';
import { createMemo, type JSX, Match, Show, Switch } from 'solid-js';
import { match } from 'ts-pattern';
import type { TimelineRow } from './collapse';
import { Emph, FeedRow, LineBody, StackedBody } from './feed-row';

/**
 * The display name for a notification's actor: the GitHub login for PR
 * events, the metadata display name for bots, else the sender's profile
 * name (reactively resolved from their user id).
 */
function createActorName(notification: () => UnifiedNotification) {
  const senderId = () => notification().sender_id ?? undefined;
  const macroId = () => {
    const id = senderId();
    return id ? tryMacroId(id) : undefined;
  };
  const [displayName] = useDisplayName(macroId());

  return createMemo(() => {
    const n = notification();
    const meta = n.notification_metadata;
    if (isGithubNotificationType(meta.tag)) {
      return getGithubSenderLogin(n) ?? 'Someone';
    }
    const metadataName = (meta.content as { senderDisplayName?: string | null })
      ?.senderDisplayName;
    return metadataName ?? displayName() ?? 'Someone';
  });
}

/** `owner/repo#123` label for GitHub PR notifications. */
function prLocation(content: {
  owner: string;
  repo: string;
  number: number;
}): string {
  return `${content.owner}/${content.repo}#${content.number}`;
}

function channelLabel(content: {
  channelName?: string | null;
  channelType?: string;
}): JSX.Element {
  if (content.channelType === 'directMessage') return 'you';
  const name = content.channelName?.replace(/^#/, '');
  return name ? <Emph>#{name}</Emph> : 'a channel';
}

type Presented = {
  title: JSX.Element;
  body?: JSX.Element;
};

/**
 * Title ("Actor to #channel", "gbirman merged owner/repo#12") and body for
 * a run of notifications sharing a collapse key. `count > 1` only occurs for
 * the collapsible types (channel sends/replies, check runs, agent replies).
 */
function present(args: {
  notifications: UnifiedNotification[];
  actor: string;
}): Presented {
  const { notifications, actor } = args;
  const first = notifications[0]!;
  const count = notifications.length;
  const meta = first.notification_metadata;

  const messageBodies = (): string[] =>
    notifications
      .map(
        (n) =>
          (n.notification_metadata.content as { messageContent?: string })
            ?.messageContent ?? ''
      )
      .map((text) => (text.trim() ? text : '*sent an attachment*'));

  const body = (lines: string[]): JSX.Element | undefined => {
    if (lines.length === 0) return undefined;
    if (lines.length === 1) return <LineBody text={lines[0]!} />;
    return <StackedBody lines={lines} />;
  };

  return match(meta)
    .with({ tag: 'channel_message_send' }, (m): Presented => {
      const location = channelLabel(m.content);
      return {
        title:
          count === 1 ? (
            <>
              <Emph>{actor}</Emph> to {location}
            </>
          ) : (
            <>
              <Emph>{actor}</Emph> sent {count} messages to {location}
            </>
          ),
        body: body(messageBodies()),
      };
    })
    .with({ tag: 'channel_message_reply' }, (m): Presented => {
      const location = channelLabel(m.content);
      return {
        title:
          count === 1 ? (
            <>
              <Emph>{actor}</Emph> replied in {location}
            </>
          ) : (
            <>
              <Emph>{actor}</Emph> sent {count} replies in {location}
            </>
          ),
        body: body(messageBodies()),
      };
    })
    .with({ tag: 'channel_mention' }, (m): Presented => {
      return {
        title: (
          <>
            <Emph>{actor}</Emph> mentioned you in {channelLabel(m.content)}
          </>
        ),
        body: body(messageBodies().slice(0, 1)),
      };
    })
    .with({ tag: 'channel_invite' }, (): Presented => {
      return {
        title: (
          <>
            <Emph>{actor}</Emph> invited you to a channel
          </>
        ),
      };
    })
    .with({ tag: 'invite_to_team' }, (): Presented => {
      return {
        title: (
          <>
            <Emph>{actor}</Emph> invited you to the team
          </>
        ),
      };
    })
    .with({ tag: 'new_email' }, (m): Presented => {
      return {
        title: (
          <>
            <Emph>{actor}</Emph> emailed you
          </>
        ),
        body: (
          <span class="min-w-0 truncate block">
            <span class="text-ink">{m.content.subject}</span>
            <Show when={m.content.snippet}>
              <span class="text-ink-extra-muted"> — {m.content.snippet}</span>
            </Show>
          </span>
        ),
      };
    })
    .with({ tag: 'commented_on_document' }, (m): Presented => {
      return {
        title: (
          <>
            <Emph>{actor}</Emph> commented on{' '}
            <Emph>{m.content.documentName}</Emph>
          </>
        ),
        body: <LineBody text={m.content.text} />,
      };
    })
    .with({ tag: 'mentioned_in_document_comment' }, (m): Presented => {
      return {
        title: (
          <>
            <Emph>{actor}</Emph> mentioned you in a comment on{' '}
            <Emph>{m.content.documentName}</Emph>
          </>
        ),
        body: <LineBody text={m.content.text} />,
      };
    })
    .with({ tag: 'replied_to_document_comment_thread' }, (m): Presented => {
      return {
        title: (
          <>
            <Emph>{actor}</Emph> replied to a comment on{' '}
            <Emph>{m.content.documentName}</Emph>
          </>
        ),
        body: <LineBody text={m.content.text} />,
      };
    })
    .with({ tag: 'document_mention' }, (m): Presented => {
      return {
        title: (
          <>
            <Emph>{actor}</Emph> shared <Emph>{m.content.documentName}</Emph>{' '}
            with you
          </>
        ),
      };
    })
    .with({ tag: 'task_assigned' }, (m): Presented => {
      return {
        title: (
          <>
            <Emph>{actor}</Emph> assigned you{' '}
            <Emph>{m.content.taskName ?? 'a task'}</Emph>
          </>
        ),
      };
    })
    .with({ tag: 'ai_response' }, (m): Presented => {
      return {
        title:
          count === 1 ? (
            <>
              <Emph>An agent</Emph> responded
            </>
          ) : (
            <>
              <Emph>An agent</Emph> sent {count} responses
            </>
          ),
        body: <LineBody text={m.content.summary} />,
      };
    })
    .with({ tag: 'call_started' }, (m): Presented => {
      const channelName = (m.content as { channelName?: string | null })
        ?.channelName;
      return {
        title: (
          <>
            <Emph>{actor}</Emph> started a call
            <Show when={channelName}>
              {(name) => (
                <>
                  {' '}
                  in <Emph>#{name()}</Emph>
                </>
              )}
            </Show>
          </>
        ),
      };
    })
    .with({ tag: 'github_pr_status_changed' }, (m): Presented => {
      const verb = match(m.content)
        .with({ status: 'merged' }, () => 'merged')
        .with({ status: 'closed' }, () => 'closed')
        .with({ action: 'reopened' }, () => 'reopened')
        .otherwise(() => 'opened');
      return {
        title: (
          <>
            <Emph>{actor}</Emph> {verb} <Emph>{prLocation(m.content)}</Emph>
          </>
        ),
        body: <LineBody text={m.content.title} />,
      };
    })
    .with({ tag: 'github_pr_comment' }, (m): Presented => {
      return {
        title: (
          <>
            <Emph>{actor}</Emph> commented on{' '}
            <Emph>{prLocation(m.content)}</Emph>
          </>
        ),
        body: <LineBody text={m.content.commentSnippet} />,
      };
    })
    .with({ tag: 'github_pr_review' }, (m): Presented => {
      const verb = match(m.content.state as string)
        .with('approved', () => 'approved')
        .with(
          'changesRequested',
          'changes_requested',
          () => 'requested changes on'
        )
        .otherwise(() => 'reviewed');
      return {
        title: (
          <>
            <Emph>{actor}</Emph> {verb} <Emph>{prLocation(m.content)}</Emph>
          </>
        ),
        body: m.content.reviewSnippet ? (
          <LineBody text={m.content.reviewSnippet} />
        ) : undefined,
      };
    })
    .with({ tag: 'github_review_requested' }, (m): Presented => {
      return {
        title: (
          <>
            <Emph>{actor}</Emph> requested your review on{' '}
            <Emph>{prLocation(m.content)}</Emph>
          </>
        ),
        body: <LineBody text={m.content.title} />,
      };
    })
    .with({ tag: 'github_pr_mention' }, (m): Presented => {
      return {
        title: (
          <>
            <Emph>{actor}</Emph> mentioned you on{' '}
            <Emph>{prLocation(m.content)}</Emph>
          </>
        ),
        body: <LineBody text={m.content.textSnippet} />,
      };
    })
    .with({ tag: 'github_pr_check_run' }, (m): Presented => {
      const verb = m.content.state === 'failed' ? 'failed' : 'ran';
      return {
        title:
          count === 1 ? (
            <>
              Check <Emph>{m.content.checkName}</Emph> {verb} on{' '}
              <Emph>{prLocation(m.content)}</Emph>
            </>
          ) : (
            <>
              {count} checks ran on <Emph>{prLocation(m.content)}</Emph>
            </>
          ),
      };
    })
    .otherwise((): Presented => {
      return {
        title: (
          <>
            <Emph>{actor}</Emph> did something
          </>
        ),
      };
    });
}

function SenderAvatar(props: { notification: UnifiedNotification }) {
  const githubAvatarUrl = () =>
    isGithubNotificationType(props.notification.notification_metadata.tag)
      ? getGithubSenderAvatarUrl(props.notification)
      : undefined;

  const senderId = () => props.notification.sender_id ?? undefined;

  return (
    <Switch
      fallback={
        <NotificationIcon
          notification={props.notification}
          class="size-4 text-ink-muted"
        />
      }
    >
      <Match when={githubAvatarUrl()}>
        {(url) => (
          <Avatar size="fill">
            <Avatar.Image src={url()} alt="GitHub avatar" />
          </Avatar>
        )}
      </Match>
      <Match when={senderId()}>
        {(id) => (
          <UserIcon id={id()} size="fill" suppressClick showTooltip={false} />
        )}
      </Match>
    </Switch>
  );
}

/**
 * A feed row for one notification, or a collapsed run of notifications
 * sharing a collapse key (same sender, same channel/PR). Clicking opens the
 * newest notification's target.
 */
export function NotificationFeedRow(props: {
  row: TimelineRow;
  connector: boolean;
}) {
  const notifications = createMemo(() =>
    props.row.items.flatMap((item) =>
      item.kind === 'notification' ? [item.notification] : []
    )
  );
  const first = () => notifications()[0]!;
  const actor = createActorName(first);
  const presented = createMemo(() =>
    present({ notifications: notifications(), actor: actor() })
  );

  return (
    <FeedRow
      avatar={<SenderAvatar notification={first()} />}
      badge={<NotificationIcon notification={first()} class="size-3" />}
      title={presented().title}
      body={presented().body}
      ts={props.row.ts}
      connector={props.connector}
      onClick={(e) => {
        const manager = globalSplitManager();
        if (!manager) return;
        void openNotification(first(), manager, e.shiftKey);
      }}
    />
  );
}
