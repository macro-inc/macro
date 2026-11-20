// Notifications for an entity, sent the way services send them: an ingress
// queue message that notification_service filters (mutes, unsubscribes),
// writes and pushes to the recipient's open sessions. `sqlNotify` writes the
// rows directly instead, for exact timestamps (ties, old, future skew); it
// pushes nothing, which the sequences record as such.

import type { Entity } from './world.ts';
import { exec, type Stack, sqsSend, sql } from './stack.ts';
import type { Rng } from './rng.ts';

const sqlStr = (value: string) => `'${value.replaceAll("'", "''")}'`;

/** A v7-shaped uuid whose time prefix is `at` (ms), random tail from rng. */
export function uuidV7(at: number, rng: Rng): string {
  const ms = at.toString(16).padStart(12, '0');
  const rand = Array.from({ length: 20 }, () => rng.int(0, 15).toString(16)).join('');
  const variant = ((rng.int(0, 15) & 0x3) | 0x8).toString(16);
  return `${ms.slice(0, 8)}-${ms.slice(8, 12)}-7${rand.slice(0, 3)}-${variant}${rand.slice(3, 6)}-${rand.slice(6, 18)}`;
}

type Tagged = { tag: string; content: Record<string, unknown> };

/** The event a service would send about this entity, by kind. */
export function eventFor(entity: Entity, sender: string, rng: Rng): Tagged {
  const messageId = rng.uuid();
  switch (entity.kind) {
    case 'document':
      return {
        tag: 'document_mention',
        content: {
          documentName: entity.name,
          owner: sender,
          messageContent: 'mentioned you',
          messageId,
          channelType: 'public',
        },
      };
    case 'task':
      return {
        tag: 'task_assigned',
        content: { assignedBy: sender, taskId: entity.id, taskName: entity.name },
      };
    case 'chat':
      return { tag: 'ai_response', content: { messageId, summary: 'An answer is ready' } };
    case 'project':
      return {
        tag: 'entity_access_requested',
        content: {
          accessLevel: 'view',
          entityName: entity.name,
          requestId: rng.uuid(),
          revision: 1,
        },
      };
    case 'initiative':
      return {
        tag: 'initiative_discussion',
        content: {
          messageId,
          owner: sender,
          projectName: entity.name,
          reason: rng.pick(['mention', 'reply', 'owner']),
          text: 'a discussion',
          threadId: rng.uuid(),
        },
      };
    case 'channel':
      return {
        tag: 'channel_message_send',
        content: {
          channelType: entity.channel?.type ?? 'public',
          channelName: entity.channel?.key,
          messageId,
          messageContent: 'new message',
        },
      };
    case 'thread':
      return {
        tag: 'channel_message_reply',
        content: {
          channelType: entity.channel?.type ?? 'public',
          channelName: entity.channel?.key,
          messageContent: 'a reply',
          messageId,
          threadId: entity.id,
        },
      };
    case 'email':
      return {
        tag: 'new_email',
        content: {
          snippet: 'new mail',
          subject: entity.name,
          threadId: entity.id,
          toEmail: 'viewer@seed.macro.local',
        },
      };
    case 'calendar':
      return {
        tag: 'calendar_event_reminder',
        content: {
          eventId: entity.id,
          minutesBefore: 10,
          occurrenceKey: entity.id,
          title: entity.name,
        },
      };
    case 'github':
      return {
        tag: 'github_pr_comment',
        content: {
          displayName: entity.name,
          foreignEntityId: entity.id,
          githubKey: `seed-org/seed-repo#${entity.id.slice(0, 4)}`,
          number: 1,
          owner: 'seed-org',
          repo: 'seed-repo',
          title: entity.name,
          url: 'https://github.com/seed-org/seed-repo/pull/1',
          commentKind: 'issue_comment',
          commentSnippet: 'a comment',
        },
      };
  }
}

function eventItem(entity: Entity) {
  return entity.kind === 'thread' && entity.channel
    ? {
        primary: { entity_type: 'channel', entity_id: entity.channel.id },
        secondary: { entity_type: 'channel_message', entity_id: entity.id },
      }
    : { primary: { entity_type: entity.itemType, entity_id: entity.id }, secondary: null };
}

/** Sends through the ingress queue; resolves once the row is written. */
export async function queueNotify(
  stack: Stack,
  queueUrl: string,
  entity: Entity,
  recipients: string[],
  senderUserId: string,
  rng: Rng,
  options: { waitMs?: number } = {}
): Promise<{ notificationId: string; written: boolean }> {
  const id = uuidV7(Date.now(), rng);
  const { primary, secondary } = eventItem(entity);
  await sqsSend(queueUrl, {
    request: {
      req: {
        notification_entity: primary,
        secondary_notification_entity: secondary,
        notification: eventFor(entity, senderUserId, rng),
        sender_id: senderUserId,
        recipient_ids: recipients,
      },
      uuid_to_write: id,
      build_apns: null,
      build_email: null,
      send_conn_gateway: true,
    },
  });
  const deadline = Date.now() + (options.waitMs ?? 20_000);
  while (Date.now() < deadline) {
    const rows = await sql<{ n: number; pub: boolean }>(
      stack,
      `SELECT count(un.*)::int AS n, bool_and(n.publication_complete) AS pub FROM notification n LEFT JOIN user_notification un ON un.notification_id = n.id WHERE n.id = '${id}'`
    );
    // A muted recipient gets no row; the notification itself still lands.
    if (rows[0] && rows[0].pub !== null && rows[0].pub) return { notificationId: id, written: rows[0].n > 0 };
    await new Promise((r) => setTimeout(r, 100));
  }
  return { notificationId: id, written: false };
}

/** Writes the rows directly at `at` (exact time; no push). */
export async function sqlNotify(
  stack: Stack,
  entity: Entity,
  recipient: string,
  senderUserId: string,
  at: Date,
  rng: Rng,
  state: 'unseen' | 'seen' | 'done' = 'unseen'
): Promise<string> {
  const id = uuidV7(at.getTime(), rng);
  await exec(stack, sqlNotifyStatement(id, entity, recipient, senderUserId, at, rng, state));
  return id;
}

export function sqlNotifyStatement(
  id: string,
  entity: Entity,
  recipient: string,
  senderUserId: string,
  at: Date,
  rng: Rng,
  state: 'unseen' | 'seen' | 'done' = 'unseen'
): string {
  const { primary, secondary } = eventItem(entity);
  const event = eventFor(entity, senderUserId, rng);
  const ts = at.toISOString().replace('T', ' ').replace('Z', '');
  return `INSERT INTO notification (id, notification_event_type, event_item_id, event_item_type, service_sender, created_at, metadata, sender_id, secondary_event_item_id, secondary_event_item_type) VALUES ('${id}', ${sqlStr(event.tag)}, ${sqlStr(primary.entity_id)}, ${sqlStr(primary.entity_type)}, 'proof', '${ts}', ${sqlStr(JSON.stringify(event.content))}::jsonb, ${sqlStr(senderUserId)}, ${secondary ? sqlStr(secondary.entity_id) : 'NULL'}, ${secondary ? sqlStr(secondary.entity_type) : 'NULL'});
INSERT INTO user_notification (user_id, notification_id, created_at, sent, seen_at, state, event_item_type, event_item_id, notification_event_type) VALUES (${sqlStr(recipient)}, '${id}', '${ts}', true, ${state === 'unseen' ? 'NULL' : `'${ts}'`}, '${state}', ${sqlStr(primary.entity_type)}, ${sqlStr(primary.entity_id)}, ${sqlStr(event.tag)});
`;
}
