import { providerIdentity } from '@app/features/external-chat/providers/identity';
import type { AgentProvider } from '@service-notification/generated/schemas';
import { format } from 'date-fns';
import { match, P } from 'ts-pattern';
import { isEntityDiscussionEvent } from './entity-discussion';
import { GITHUB_EVENT_TYPES } from './github-event-types';
import type { UnifiedNotification } from './types';

// Helper functions for derived notification data

/** "Scout has stopped.", as the notification service words its body. */
export function stoppedAgentsText(
  agents: readonly { name: string }[],
  runtimeName: string
): string {
  const [first, second, ...rest] = agents.map((agent) => agent.name);
  if (!first) return `Agents on ${runtimeName} have stopped.`;
  if (!second) return `${first} has stopped.`;
  if (rest.length === 0) return `${first} and ${second} have stopped.`;
  return `${first} and ${rest.length + 1} others have stopped.`;
}

export function getNotificationAction(n: UnifiedNotification): string {
  return (
    match(n.notification_metadata.tag)
      .with('channel_mention', () => 'mentioned you in')
      .with('document_mention', () => {
        const meta = n.notification_metadata;
        if (
          meta.tag === 'document_mention' &&
          meta.content.subType?.type === 'task'
        ) {
          return 'sent a task';
        }

        return 'sent a document';
      })
      .with(
        'mentioned_in_document_comment',
        () => 'mentioned you in a comment on'
      )
      .with(
        'replied_to_document_comment_thread',
        () => 'replied to a comment on'
      )
      .with('entity_access_requested', () => {
        // A runtime has one role to ask for: being a user of it.
        if (n.entity_type === 'harness') return 'requested to use';
        return `requested ${n.notification_metadata.tag === 'entity_access_requested' ? n.notification_metadata.content.accessLevel : ''} access to`;
      })
      .with(
        'entity_access_granted',
        () =>
          `granted you ${n.notification_metadata.tag === 'entity_access_granted' ? n.notification_metadata.content.accessLevel : ''} access to`
      )
      .with('commented_on_document', () => 'commented on')
      .with(P.union('initiative_discussion', 'crm_discussion'), () => {
        const meta = n.notification_metadata;
        if (!isEntityDiscussionEvent(meta)) return 'commented on';
        return meta.content.reason === 'mention'
          ? 'mentioned you in a comment on'
          : meta.content.reason === 'reply'
            ? 'replied to a comment on'
            : 'commented on';
      })
      .with('channel_message_send', () => 'sent a message in')
      .with('channel_message_reaction', () => 'reacted to your message in')
      .with('ai_response', () => 'AI responded')
      .with('channel_message_reply', () => 'replied in')
      .with('call_started', () => 'started a call')
      .with('channel_invite', () => 'invited you to')
      .with('channel_access_requested', () => 'asked to join')
      .with('new_email', () => 'sent a new email')
      .with('external_chat_message', () => {
        const meta = n.notification_metadata;
        if (n.sender_id || meta.tag !== 'external_chat_message')
          return 'sent a message in';
        return `New ${providerIdentity(meta.content.provider).label} message in`;
      })
      .with('invite_to_team', () => 'invited you to')
      .with('task_assigned', () => 'assigned you a task')
      // Self-set, so there is no actor — the sentence reads "Reminder about X"
      // rather than "<someone> reminded you about X".
      .with('reminder', () => 'Reminder')
      // Same shape: no actor, reads "Upcoming event · <event title>".
      .with('calendar_event_reminder', () => 'Upcoming event')
      .with('calendar_event_join_request', () => 'asked to join')
      .with('github_pr_status_changed', () => 'updated a pull request')
      .with('github_pr_check_run', () => {
        const meta = n.notification_metadata;
        if (
          meta.tag === 'github_pr_check_run' &&
          meta.content.state === 'failed'
        ) {
          return 'failed a check on';
        }

        return 'completed a check on';
      })
      .with('github_review_requested', () => 'requested your review on')
      .with('github_pr_comment', () => 'commented on')
      .with('github_pr_mention', () => 'mentioned you in')
      .with('github_pr_review', () => 'reviewed')
      .with('inbox_reauth_required', () => 'needs reconnection')
      // The bot is the actor: "<bot> finished <session>".
      .with('agent_session_settled', () => 'finished')
      .with('agent_session_waiting_for_input', () => 'needs your answer in')
      .with('agent_session_mentioned', () => 'mentioned you in')
      // The routine is the actor: "<routine> failed".
      .with('routine_run_finished', () =>
        routineRunFailed(n) ? 'failed' : 'finished'
      )
      // The computer is the actor: "<computer> Claude sign-in expired".
      .with('agent_sign_in_expiry', () => {
        const meta = n.notification_metadata;
        if (meta.tag !== 'agent_sign_in_expiry') return 'sign-in expires soon';
        const agent = agentDisplayName(meta.content.agent);
        return match(meta.content.stage)
          .with('expires_soon', () => `${agent} sign-in expires soon`)
          .with('expires_today', () => `${agent} sign-in expires today`)
          .with('expired', () => `${agent} sign-in expired`)
          .exhaustive(() => `${agent} sign-in expires soon`);
      })
      .with('ping', () => 'notified you')
      .with('runtime_access_removed', () => 'removed your access to')
      // The computer is the actor: "<computer> is ready".
      .with('computer_setup', () => {
        const meta = n.notification_metadata;
        return meta.tag === 'computer_setup' &&
          meta.content.outcome.kind === 'failed'
          ? 'could not be set up'
          : 'is ready';
      })
      .exhaustive(() => 'notified you about')
  );
}

export function getNotificationTargetName(
  n: UnifiedNotification
): string | undefined {
  const m = n.notification_metadata;
  return (
    match(m)
      .with({ tag: 'channel_invite' }, (m) => m.content.channelName)
      .with({ tag: 'channel_access_requested' }, (m) => m.content.channelName)
      .with({ tag: 'document_mention' }, (m) => m.content.documentName)
      .with(
        { tag: 'mentioned_in_document_comment' },
        (m) => m.content.documentName
      )
      .with(
        { tag: 'replied_to_document_comment_thread' },
        (m) => m.content.documentName
      )
      .with({ tag: 'initiative_discussion' }, (m) => m.content.projectName)
      .with(
        { tag: P.union('entity_access_requested', 'entity_access_granted') },
        (m) => m.content.entityName
      )
      .with({ tag: 'commented_on_document' }, (m) => m.content.documentName)
      .with({ tag: 'crm_discussion' }, (m) => m.content.recordName)
      .with({ tag: 'invite_to_team' }, (m) => m.content.teamName)
      .with({ tag: 'task_assigned' }, (m) => m.content.taskName ?? undefined)
      .with(
        { tag: P.union(...GITHUB_EVENT_TYPES) },
        (m) => `${m.content.owner}/${m.content.repo}#${m.content.number}`
      )
      .with(
        {
          tag: P.union(
            'channel_mention',
            'channel_message_send',
            'channel_message_reaction',
            'channel_message_reply'
          ),
        },
        (m) => m.content.channelName || undefined
      )
      .with({ tag: 'ai_response' }, () => undefined)
      .with({ tag: 'call_started' }, (m) => m.content.channel_name ?? undefined)
      .with({ tag: 'new_email' }, () => undefined)
      .with({ tag: 'external_chat_message' }, (m) => m.content.chatName)
      // The reminder's entity name is resolved from the notification's entity,
      // not carried in the metadata.
      .with({ tag: 'reminder' }, () => undefined)
      .with(
        {
          tag: P.union(
            'calendar_event_reminder',
            'calendar_event_join_request'
          ),
        },
        (m) => m.content.title || '(No title)'
      )
      .with({ tag: 'inbox_reauth_required' }, () => undefined)
      .with({ tag: 'routine_run_finished' }, () => undefined)
      .with({ tag: 'agent_sign_in_expiry' }, () => undefined)
      .with({ tag: 'computer_setup' }, () => undefined)
      .with({ tag: 'ping' }, () => undefined)
      .with(
        {
          tag: P.union(
            'agent_session_settled',
            'agent_session_waiting_for_input',
            'agent_session_mentioned'
          ),
        },
        (m) => m.content.sessionName
      )
      .with({ tag: 'runtime_access_removed' }, (m) => m.content.runtimeName)
      .exhaustive(() => undefined)
  );
}

export function getNotificationContent(
  n: UnifiedNotification
): string | undefined {
  const m = n.notification_metadata;
  return (
    match(m)
      .with({ tag: 'channel_mention' }, (m) => m.content.messageContent)
      .with({ tag: 'channel_message_send' }, (m) => m.content.messageContent)
      .with(
        { tag: 'channel_message_reaction' },
        (m) => `${m.content.emoji} · ${m.content.messageContent}`
      )
      .with({ tag: 'ai_response' }, (m) => m.content.summary)
      .with({ tag: 'channel_message_reply' }, (m) => m.content.messageContent)
      .with({ tag: 'call_started' }, () => undefined)
      .with({ tag: 'document_mention' }, (m) => m.content.documentName)
      .with({ tag: 'mentioned_in_document_comment' }, (m) => m.content.text)
      .with(
        { tag: 'replied_to_document_comment_thread' },
        (m) => m.content.text
      )
      .with({ tag: 'initiative_discussion' }, (m) => m.content.text)
      .with(
        { tag: P.union('entity_access_requested', 'entity_access_granted') },
        () => undefined
      )
      .with({ tag: 'commented_on_document' }, (m) => m.content.text)
      .with({ tag: 'crm_discussion' }, (m) => m.content.text)
      .with({ tag: 'new_email' }, (m) => m.content.subject)
      .with(
        { tag: 'external_chat_message' },
        (m) => `New ${providerIdentity(m.content.provider).label} message`
      )
      .with({ tag: 'task_assigned' }, (m) => m.content.taskName ?? undefined)
      .with(
        { tag: P.union('github_pr_status_changed', 'github_review_requested') },
        (m) => m.content.title || m.content.displayName
      )
      .with(
        { tag: 'github_pr_check_run' },
        (m) => m.content.checkName || m.content.title || m.content.displayName
      )
      .with(
        { tag: 'github_pr_comment' },
        (m) =>
          m.content.commentSnippet || m.content.title || m.content.displayName
      )
      .with(
        { tag: 'github_pr_mention' },
        (m) => m.content.textSnippet || m.content.title || m.content.displayName
      )
      .with(
        { tag: 'github_pr_review' },
        (m) =>
          m.content.reviewSnippet || m.content.title || m.content.displayName
      )
      .with({ tag: 'channel_invite' }, () => undefined)
      .with({ tag: 'channel_access_requested' }, () => undefined)
      .with({ tag: 'invite_to_team' }, () => undefined)
      // The description the user wrote is the whole point of a reminder.
      .with({ tag: 'reminder' }, (m) => m.content.description)
      .with({ tag: 'calendar_event_reminder' }, (m) =>
        formatCalendarReminderTime(m.content)
      )
      .with({ tag: 'calendar_event_join_request' }, () => undefined)
      .with({ tag: 'inbox_reauth_required' }, (m) => m.content.emailAddress)
      .with(
        { tag: 'agent_session_settled' },
        (m) => m.content.excerpt ?? undefined
      )
      .with(
        { tag: 'agent_session_waiting_for_input' },
        (m) => m.content.question
      )
      .with({ tag: 'agent_session_mentioned' }, () => undefined)
      .with({ tag: 'routine_run_finished' }, (m) =>
        m.content.outcome === 'failed' ? 'Its run failed.' : 'Its run finished.'
      )
      .with({ tag: 'agent_sign_in_expiry' }, (m) => {
        const agent = agentDisplayName(m.content.agent);
        const when = match(m.content.stage)
          .with('expires_soon', () => 'expires soon')
          .with('expires_today', () => 'expires today')
          .with('expired', () => 'expired')
          .exhaustive();
        return `Its ${agent} sign-in ${when}. Sign in again in Settings → Machines.`;
      })
      .with({ tag: 'ping' }, (m) => pingText(m.content))
      .with({ tag: 'runtime_access_removed' }, (m) =>
        stoppedAgentsText(m.content.agents, m.content.runtimeName)
      )
      .with({ tag: 'computer_setup' }, (m) =>
        match(m.content.outcome)
          .with(
            { kind: 'ready' },
            () =>
              'Connect your AI and finish setup, then create an agent on it.'
          )
          .with(
            { kind: 'failed' },
            ({ failureReason }) => `${failureReason} Retry from the setup flow.`
          )
          .exhaustive()
      )
      .exhaustive(() => undefined)
  );
}

/**
 * Renders the occurrence's time in the viewer's zone: "2:30 PM – 3:00 PM"
 * for timed events, "All day" otherwise. Kept in the viewer's zone — a
 * reminder is read where the user is, not where the event was created.
 */
export function formatCalendarReminderTime(content: {
  startsAt?: string | null;
  endsAt?: string | null;
  startDate?: string | null;
}): string | undefined {
  if (!content.startsAt) {
    return content.startDate ? 'All day' : undefined;
  }
  const start = format(new Date(content.startsAt), 'p');
  if (!content.endsAt) return start;
  return `${start} – ${format(new Date(content.endsAt), 'p')}`;
}

export function shouldShowNotificationTarget(n: UnifiedNotification): boolean {
  const m = n.notification_metadata;
  return (
    match(m)
      .with(
        { tag: 'channel_mention' },
        (m) => m.content.channelType !== 'directMessage'
      )
      .with(
        { tag: 'channel_message_send' },
        (m) => m.content.channelType !== 'directMessage'
      )
      .with(
        { tag: 'channel_message_reaction' },
        (m) => m.content.channelType !== 'directMessage'
      )
      .with(
        { tag: 'channel_message_reply' },
        (m) => m.content.channelType !== 'directMessage'
      )
      .with({ tag: 'ai_response' }, () => false)
      .with({ tag: 'call_started' }, () => true)
      .with({ tag: 'new_email' }, () => false)
      .with({ tag: 'external_chat_message' }, () => true)
      .with({ tag: 'task_assigned' }, () => true)
      .with({ tag: P.union(...GITHUB_EVENT_TYPES) }, () => true)
      .with({ tag: 'document_mention' }, () => true)
      .with({ tag: 'mentioned_in_document_comment' }, () => true)
      .with({ tag: 'replied_to_document_comment_thread' }, () => true)
      .with({ tag: 'initiative_discussion' }, () => true)
      .with(
        { tag: P.union('entity_access_requested', 'entity_access_granted') },
        () => true
      )
      .with({ tag: 'commented_on_document' }, () => true)
      .with({ tag: 'crm_discussion' }, () => true)
      .with({ tag: 'channel_invite' }, () => true)
      .with({ tag: 'channel_access_requested' }, () => true)
      .with({ tag: 'invite_to_team' }, () => true)
      // Shown so "Reminder" reads as being about something; a standalone
      // reminder resolves to no target name and renders without one anyway.
      .with({ tag: 'reminder' }, () => true)
      .with({ tag: 'calendar_event_reminder' }, () => true)
      .with({ tag: 'calendar_event_join_request' }, () => true)
      .with({ tag: 'inbox_reauth_required' }, () => false)
      .with({ tag: 'routine_run_finished' }, () => false)
      .with({ tag: 'agent_sign_in_expiry' }, () => false)
      .with({ tag: 'computer_setup' }, () => false)
      .with({ tag: 'ping' }, () => false)
      .with({ tag: 'runtime_access_removed' }, () => true)
      .with(
        {
          tag: P.union(
            'agent_session_settled',
            'agent_session_waiting_for_input',
            'agent_session_mentioned'
          ),
        },
        () => true
      )
      .exhaustive(() => true)
  );
}

/** The agent's name as people see it, e.g. "Claude". */
function agentDisplayName(agent: AgentProvider): string {
  return match(agent)
    .with('claude', () => 'Claude')
    .exhaustive();
}

/** A ping's words: its title, then its body when it has one. */
export function pingText(content: {
  title: string;
  body?: string | null;
}): string {
  return content.body ? `${content.title} — ${content.body}` : content.title;
}

function routineRunFailed(n: UnifiedNotification): boolean {
  const meta = n.notification_metadata;
  return (
    meta.tag === 'routine_run_finished' && meta.content.outcome === 'failed'
  );
}
