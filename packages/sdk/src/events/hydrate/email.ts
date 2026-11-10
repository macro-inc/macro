import { match } from 'ts-pattern';
import { EmailDraft } from '../../entities/email/draft';
import { Link } from '../../entities/email/link';
import { EmailMessage } from '../../entities/email/message';
import { EmailThread } from '../../entities/email/thread';
import { User } from '../../entities/users/user';
import type { MacroClient } from '../../utils/client';
import type { MacroEvent } from '../types';

export type EmailEvent = Extract<MacroEvent, { event_type: `email.${string}` }>;

/** Attach the inbox, owner, thread, message or draft, and actor handles named by each email event. */
export function hydrateEmailEvent(client: MacroClient, event: EmailEvent) {
  const common = (metadata: { link_id: string; owner: string }) => ({
    inbox: Link.byId(client, metadata.link_id),
    owner: User.byId(client, metadata.owner),
  });
  const thread = (metadata: { thread_id: string }) => ({
    thread: EmailThread.byId(client, metadata.thread_id),
  });
  const message = (metadata: { message_id: string }) => ({
    message: EmailMessage.byId(client, metadata.message_id),
  });
  const actor = (metadata: { actor?: string | null }) => ({
    actor: metadata.actor ? User.byId(client, metadata.actor) : undefined,
  });

  return match(event)
    .with({ event_type: 'email.link_connected' }, ({ metadata }) => ({
      event_type: 'email.link_connected' as const,
      metadata,
      ...common(metadata),
    }))
    .with({ event_type: 'email.link_disconnected' }, ({ metadata }) => ({
      event_type: 'email.link_disconnected' as const,
      metadata,
      ...common(metadata),
    }))
    .with({ event_type: 'email.link_reauth_required' }, ({ metadata }) => ({
      event_type: 'email.link_reauth_required' as const,
      metadata,
      ...common(metadata),
    }))
    .with({ event_type: 'email.message_received' }, ({ metadata }) => ({
      event_type: 'email.message_received' as const,
      metadata,
      ...common(metadata),
      ...thread(metadata),
      ...message(metadata),
    }))
    .with({ event_type: 'email.message_draft_synced' }, ({ metadata }) => ({
      event_type: 'email.message_draft_synced' as const,
      metadata,
      ...common(metadata),
      ...thread(metadata),
      draft: EmailDraft.byId(client, metadata.message_id),
    }))
    .with({ event_type: 'email.message_sent' }, ({ metadata }) => ({
      event_type: 'email.message_sent' as const,
      metadata,
      ...common(metadata),
      ...thread(metadata),
      ...message(metadata),
      ...actor(metadata),
    }))
    .with({ event_type: 'email.message_deleted' }, ({ metadata }) => ({
      event_type: 'email.message_deleted' as const,
      metadata,
      ...common(metadata),
      ...thread(metadata),
    }))
    .with({ event_type: 'email.message_send_queued' }, ({ metadata }) => ({
      event_type: 'email.message_send_queued' as const,
      metadata,
      ...common(metadata),
      ...thread(metadata),
      ...message(metadata),
      ...actor(metadata),
    }))
    .with({ event_type: 'email.message_send_cancelled' }, ({ metadata }) => ({
      event_type: 'email.message_send_cancelled' as const,
      metadata,
      ...common(metadata),
      ...thread(metadata),
      ...message(metadata),
      ...actor(metadata),
    }))
    .with({ event_type: 'email.thread_archived' }, ({ metadata }) => ({
      event_type: 'email.thread_archived' as const,
      metadata,
      ...common(metadata),
      ...thread(metadata),
      ...actor(metadata),
    }))
    .with({ event_type: 'email.thread_trashed' }, ({ metadata }) => ({
      event_type: 'email.thread_trashed' as const,
      metadata,
      ...common(metadata),
      ...thread(metadata),
      ...actor(metadata),
    }))
    .with({ event_type: 'email.thread_read' }, ({ metadata }) => ({
      event_type: 'email.thread_read' as const,
      metadata,
      ...common(metadata),
      ...thread(metadata),
      ...actor(metadata),
    }))
    .with({ event_type: 'email.thread_starred' }, ({ metadata }) => ({
      event_type: 'email.thread_starred' as const,
      metadata,
      ...common(metadata),
      ...thread(metadata),
      ...actor(metadata),
    }))
    .with({ event_type: 'email.thread_spam_changed' }, ({ metadata }) => ({
      event_type: 'email.thread_spam_changed' as const,
      metadata,
      ...common(metadata),
      ...thread(metadata),
      ...actor(metadata),
    }))
    .with({ event_type: 'email.thread_project_changed' }, ({ metadata }) => ({
      event_type: 'email.thread_project_changed' as const,
      metadata,
      ...common(metadata),
      ...thread(metadata),
      actor: User.byId(client, metadata.actor),
    }))
    .with({ event_type: 'email.thread_labels_updated' }, ({ metadata }) => ({
      event_type: 'email.thread_labels_updated' as const,
      metadata,
      ...common(metadata),
      ...thread(metadata),
      ...actor(metadata),
    }))
    .with({ event_type: 'email.thread_backfilled' }, ({ metadata }) => ({
      event_type: 'email.thread_backfilled' as const,
      metadata,
      ...common(metadata),
      ...thread(metadata),
    }))
    .with(
      { event_type: 'email.threads_reindex_requested' },
      ({ metadata }) => ({
        event_type: 'email.threads_reindex_requested' as const,
        metadata,
        ...common(metadata),
        threads: metadata.thread_ids.map((id) => EmailThread.byId(client, id)),
      }),
    )
    .exhaustive((unknown) => {
      console.warn('macro sdk: unknown email event', unknown);
      return undefined;
    });
}
