import { afterEach, describe, expect, test } from 'bun:test';
import { EmailDraft } from '../src/entities/email/draft';
import { Link } from '../src/entities/email/link';
import { EmailMessage } from '../src/entities/email/message';
import { EmailThread } from '../src/entities/email/thread';
import { User } from '../src/entities/users/user';
import {
  type EmailEvent,
  hydrateEmailEvent,
} from '../src/events/hydrate/email';
import type { EventMap } from '../src/events/types';
import { Macro } from '../src/macro';
import type { MacroClient } from '../src/utils/client';

const client = {} as MacroClient;
const originalFetch = globalThis.fetch;
const linkId = '01a00000-0000-7000-8000-000000000001';
const threadId = '01a00000-0000-7000-8000-000000000002';
const messageId = '01a00000-0000-7000-8000-000000000003';
const owner = 'macro|owner@example.com';
const actor = 'macro|actor@example.com';

afterEach(() => {
  globalThis.fetch = originalFetch;
});

const received: Extract<EmailEvent, { event_type: 'email.message_received' }> =
  {
    event_type: 'email.message_received',
    metadata: {
      link_id: linkId,
      owner,
      thread_id: threadId,
      message_id: messageId,
      provider_message_id: 'provider-message',
      provider_thread_id: 'provider-thread',
      is_new_thread: true,
      subject: 'Subject',
      from_email: 'sender@example.com',
      from_name: null,
      to_emails: ['receiver@example.com'],
      attachment_count: 0,
      is_spam_or_trash: false,
      received_at: null,
    },
  };

function streamBody(event: EmailEvent): string {
  return `event: ${event.event_type}\ndata: ${JSON.stringify(event)}\n\n`;
}

async function signature(secret: string, timestamp: string, body: string) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const digest = await crypto.subtle.sign(
    'HMAC',
    key,
    encoder.encode(`${timestamp}.${body}`),
  );
  return `v1=${new Uint8Array(digest).toHex()}`;
}

describe('email events', () => {
  test('SSE receives message_received with hydrated handles and derived filter', async () => {
    let request: Request | undefined;
    const delivered =
      Promise.withResolvers<EventMap['email.message_received']>();
    globalThis.fetch = (async (input) => {
      request = input instanceof Request ? input : new Request(input);
      return new Response(streamBody(received), {
        headers: { 'content-type': 'text/event-stream' },
      });
    }) as typeof fetch;

    const macro = new Macro({
      token: 'user-token',
      hosts: { storage: 'https://storage.example.test' },
    });
    macro.events.on('email.message_received', (event) =>
      delivered.resolve(event),
    );
    const stop = await macro.events.listen();
    const event = await delivered.promise;
    stop();

    expect(
      JSON.parse(
        new URL(request?.url ?? '').searchParams.get('filters') ?? '[]',
      ),
    ).toEqual([{ events: ['email.message_received'] }]);
    expect(event.metadata).toEqual(received.metadata);
    expect(event.inbox).toBeInstanceOf(Link);
    expect(event.inbox.id).toBe(linkId);
    expect(event.owner).toBeInstanceOf(User);
    expect(event.owner.id).toBe(owner);
    expect(event.thread).toBeInstanceOf(EmailThread);
    expect(event.thread.id).toBe(threadId);
    expect(event.message).toBeInstanceOf(EmailMessage);
    expect(event.message.id).toBe(messageId);
  });

  test('signed webhook dispatches thread_archived', async () => {
    const archived: Extract<
      EmailEvent,
      { event_type: 'email.thread_archived' }
    > = {
      event_type: 'email.thread_archived',
      metadata: {
        link_id: linkId,
        owner,
        actor,
        thread_id: threadId,
        archived: true,
        origin: 'user_action',
      },
    };
    const body = JSON.stringify(archived);
    const secret = 'whsec_test';
    const timestamp = '1710000000';
    const delivered =
      Promise.withResolvers<EventMap['email.thread_archived']>();
    const macro = new Macro({ token: 'user-token', webhookSecret: secret });
    macro.events.on('email.thread_archived', (event) =>
      delivered.resolve(event),
    );

    await macro.events.handle(body, {
      event: 'email.thread_archived',
      eventId: 'event-1',
      timestamp,
      signature: await signature(secret, timestamp, body),
    });
    const event = await delivered.promise;
    expect(event.metadata).toEqual(archived.metadata);
    expect(event.thread.id).toBe(threadId);
    expect(event.inbox.id).toBe(linkId);
    expect(event.owner.id).toBe(owner);
    expect(event.actor?.id).toBe(actor);
  });

  test('every email variant attaches exactly its contract handles', () => {
    const common = { link_id: linkId, owner };
    const thread = { ...common, thread_id: threadId };
    const message = { ...thread, message_id: messageId };
    const cases = [
      [
        {
          event_type: 'email.link_connected',
          metadata: {
            ...common,
            email_address: 'owner@example.com',
            provider: 'GMAIL',
            is_primary: true,
            connected_at: '2026-01-01T00:00:00Z',
          },
        },
        ['inbox', 'owner'],
      ],
      [
        {
          event_type: 'email.link_disconnected',
          metadata: {
            ...common,
            email_address: 'owner@example.com',
            reason: 'manually_disabled',
          },
        },
        ['inbox', 'owner'],
      ],
      [
        {
          event_type: 'email.link_reauth_required',
          metadata: {
            ...common,
            email_address: 'owner@example.com',
            observed_at: '2026-01-01T00:00:00Z',
          },
        },
        ['inbox', 'owner'],
      ],
      [received, ['inbox', 'owner', 'thread', 'message']],
      [
        {
          event_type: 'email.message_draft_synced',
          metadata: {
            ...message,
            provider_message_id: 'provider-message',
            provider_thread_id: 'provider-thread',
            is_spam_or_trash: false,
          },
        },
        ['inbox', 'owner', 'thread', 'draft'],
      ],
      [
        {
          event_type: 'email.message_sent',
          metadata: {
            ...message,
            actor,
            provider_message_id: 'provider-message',
            provider_thread_id: 'provider-thread',
            subject: null,
            to_emails: [],
            cc_emails: [],
            origin: 'user_action',
            sent_at: '2026-01-01T00:00:00Z',
          },
        },
        ['inbox', 'owner', 'thread', 'message', 'actor'],
      ],
      [
        {
          event_type: 'email.message_deleted',
          metadata: { ...message, provider_message_id: 'provider-message' },
        },
        ['inbox', 'owner', 'thread'],
      ],
      [
        {
          event_type: 'email.message_send_queued',
          metadata: {
            ...message,
            actor,
            scheduled_send_at: '2026-01-01T00:00:00Z',
            is_scheduled: false,
          },
        },
        ['inbox', 'owner', 'thread', 'message', 'actor'],
      ],
      [
        {
          event_type: 'email.message_send_cancelled',
          metadata: { ...message, actor, reason: 'undo' },
        },
        ['inbox', 'owner', 'thread', 'message', 'actor'],
      ],
      [
        {
          event_type: 'email.thread_archived',
          metadata: { ...thread, actor, archived: true, origin: 'user_action' },
        },
        ['inbox', 'owner', 'thread', 'actor'],
      ],
      [
        {
          event_type: 'email.thread_trashed',
          metadata: { ...thread, actor, trashed: true, origin: 'user_action' },
        },
        ['inbox', 'owner', 'thread', 'actor'],
      ],
      [
        {
          event_type: 'email.thread_read',
          metadata: { ...thread, actor, is_read: true, origin: 'user_action' },
        },
        ['inbox', 'owner', 'thread', 'actor'],
      ],
      [
        {
          event_type: 'email.thread_starred',
          metadata: { ...thread, actor, starred: true, origin: 'user_action' },
        },
        ['inbox', 'owner', 'thread', 'actor'],
      ],
      [
        {
          event_type: 'email.thread_spam_changed',
          metadata: { ...thread, actor, spam: true, origin: 'user_action' },
        },
        ['inbox', 'owner', 'thread', 'actor'],
      ],
      [
        {
          event_type: 'email.thread_project_changed',
          metadata: {
            ...thread,
            actor,
            previous_project_id: null,
            project_id: 'project-1',
          },
        },
        ['inbox', 'owner', 'thread', 'actor'],
      ],
      [
        {
          event_type: 'email.thread_labels_updated',
          metadata: {
            ...thread,
            actor,
            added: [],
            removed: [],
            origin: 'user_action',
          },
        },
        ['inbox', 'owner', 'thread', 'actor'],
      ],
    ] as const satisfies ReadonlyArray<
      readonly [EmailEvent, readonly string[]]
    >;

    type CoveredEvents = Assert<
      Equal<(typeof cases)[number][0]['event_type'], EmailEvent['event_type']>
    >;
    const coveredEvents: CoveredEvents = true;
    void coveredEvents;

    for (const [input, keys] of cases) {
      const event = hydrateEmailEvent(client, input);
      expect(event?.event_type).toBe(input.event_type);
      expect(event?.metadata).toEqual(input.metadata);
      expect(
        Object.keys(event ?? {}).filter(
          (key) => key !== 'event_type' && key !== 'metadata',
        ),
      ).toEqual([...keys]);
      expect(event?.inbox.id).toBe(linkId);
      expect(event?.owner.id).toBe(owner);
      if (event && 'thread' in event) {
        expect(event.thread.id).toBe(threadId);
      }
      if (event && 'message' in event) {
        expect(event.message.id).toBe(messageId);
      }
      if (event && 'draft' in event) {
        expect(event.draft.id).toBe(messageId);
      }
      if (event && 'actor' in event) {
        expect(event.actor?.id).toBe(actor);
      }
    }
  });

  test('deleted messages have no handle, drafts have a draft, and null actor stays undefined', () => {
    const deleted = hydrateEmailEvent(client, {
      event_type: 'email.message_deleted',
      metadata: {
        link_id: linkId,
        owner,
        thread_id: threadId,
        message_id: messageId,
        provider_message_id: 'provider-message',
      },
    });
    expect(deleted).not.toHaveProperty('message');

    const draft = hydrateEmailEvent(client, {
      event_type: 'email.message_draft_synced',
      metadata: {
        link_id: linkId,
        owner,
        thread_id: threadId,
        message_id: messageId,
        provider_message_id: 'provider-message',
        provider_thread_id: 'provider-thread',
        is_spam_or_trash: false,
      },
    });
    expect(
      draft?.event_type === 'email.message_draft_synced' && draft.draft,
    ).toBeInstanceOf(EmailDraft);
    expect(draft).not.toHaveProperty('message');

    const archived = hydrateEmailEvent(client, {
      event_type: 'email.thread_archived',
      metadata: {
        link_id: linkId,
        owner,
        actor: null,
        thread_id: threadId,
        archived: true,
        origin: 'provider_sync',
      },
    });
    expect(
      archived?.event_type === 'email.thread_archived' && archived.actor,
    ).toBeUndefined();

    const read = hydrateEmailEvent(client, {
      event_type: 'email.thread_read',
      metadata: {
        link_id: linkId,
        owner,
        actor: null,
        thread_id: threadId,
        is_read: true,
        origin: 'provider_sync',
      },
    });
    expect(
      read?.event_type === 'email.thread_read' && read.actor,
    ).toBeUndefined();
  });
});

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;
type Assert<T extends true> = T;
type ThreadHandle = Assert<
  Equal<EventMap['email.message_received']['thread'], EmailThread>
>;
type ReadState = Assert<
  Equal<EventMap['email.thread_read']['metadata']['is_read'], boolean>
>;
const typeChecks: [ThreadHandle, ReadState] = [true, true];
void typeChecks;
