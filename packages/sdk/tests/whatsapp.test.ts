import { afterEach, expect, test } from 'bun:test';
import {
  Macro,
  WhatsAppMessage,
  WhatsAppSend,
  WhatsAppUpload,
} from '../src/macro';

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

const account = {
  id: 'account',
  user_id: 'owner',
  state: 'connected',
  identity_jid: '15550000001@s.whatsapp.net',
  authorization_generation: 1,
};
const summary = {
  id: 'group',
  name: 'Support',
  user_id: 'owner',
  unread_count: 1,
  last_message_at: '2026-10-21',
  can_send: true,
  send_reason: null,
};
const remote = {
  jid: '12036301@g.us',
  name: 'Remote support',
  observedAt: '2026-10-21',
  participants: [],
  announce: false,
  disappearing: false,
  community: false,
  group: null,
};
const detail = {
  ...summary,
  roster: remote,
  sending_identity: account.identity_jid,
  access_level: 'owner',
  share_permission: {
    id: 'permission',
    owner: 'owner',
    linkShare: null,
    teamShareAccessLevel: null,
  },
  limits: {
    text_limit_bytes: 16384,
    mutation_window_seconds: 600,
    max_attachments: 1,
    attachment_limit_bytes: 33554432,
    attachment_types: ['text/plain'],
    mutations: ['reaction', 'edit', 'delete'],
  },
};
const progress = {
  id: 'intent',
  group_id: 'group',
  user_id: 'owner',
  state: 'unknown',
  message_id: null,
  error_code: null,
  created_at: '2026-10-21',
  payload: {
    idempotency_key: 'stable',
    message: { type: 'text', text: 'hello' },
  },
};
const message = {
  id: 'message',
  sender: { person_id: 'person', user_id: null, name: 'Customer' },
  body: 'hello',
  reply_to: null,
  sent_at: '2026-10-21',
  received_at: '2026-10-21',
  edited_at: null,
  deleted: false,
  reactions: [],
  attachments: [],
  delivery_state: null,
};

function fixture(handler: (request: Request) => Response | Promise<Response>) {
  const requests: Request[] = [];
  globalThis.fetch = (async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init);
    requests.push(request.clone());
    return handler(request);
  }) as typeof fetch;
  const macro = new Macro({
    token: 'owner-api-token',
    hosts: { storage: 'https://storage.example.test' },
  });
  return { macro, requests, group: macro.whatsapp.byId('group') };
}

test('shared groups can be listed without a WhatsApp connection and handles fetch standalone detail', async () => {
  const { macro, requests } = fixture((request) =>
    Response.json(
      new URL(request.url).pathname.endsWith('/whatsapp-groups')
        ? [summary]
        : detail,
    ),
  );
  const groups = await macro.whatsapp.groups();
  expect(groups[0].entityType).toBe('whatsapp_group');
  expect(await groups[0].name()).toBe('Support');
  expect(await groups[0].canSend()).toBe(true);
  expect(requests.map((r) => new URL(r.url).pathname)).toEqual([
    '/meta/linked/whatsapp-groups',
    '/meta/linked/whatsapp-groups/group',
  ]);
  expect(JSON.stringify(groups[0])).not.toContain('owner-api-token');
});

test('remote discovery and adoption return a shareable group handle with no audience input', async () => {
  const { macro, requests } = fixture((request) =>
    Response.json(request.method === 'POST' ? { group_id: 'group' } : [remote]),
  );
  const [discovered] = await macro.whatsapp.remoteGroups();
  expect(await discovered.group()).toBeUndefined();
  const adopted = await discovered.adopt({ name: 'Support' });
  expect(adopted.id).toBe('group');
  expect(new URL(requests[1].url).pathname).toBe('/meta/linked/groups/adopt');
  expect(await requests[1].json()).toEqual({
    group_jid: remote.jid,
    name: 'Support',
  });
});

test('account access stays owner-scoped and no account normalizes to undefined', async () => {
  let current: unknown = { account: null };
  const { macro } = fixture(() => Response.json(current));
  expect(await macro.whatsapp.account()).toBeUndefined();
  current = { account };
  expect((await macro.whatsapp.account())?.id).toBe('account');
});

test('timeline pagination is lazy and messages use their own group-scoped handles', async () => {
  const { group, requests } = fixture((request) =>
    Response.json(
      new URL(request.url).searchParams.has('before')
        ? { messages: [{ ...message, id: 'older' }], next_cursor: null }
        : { messages: [message], next_cursor: 'message' },
    ),
  );
  const iterator = group.messages({ limit: 1 });
  expect(requests).toHaveLength(0);
  const first = await iterator.next();
  expect(first.value).toBeInstanceOf(WhatsAppMessage);
  expect(first.value && (await first.value.body())).toBe('hello');
  expect(requests).toHaveLength(1);
  await iterator.return(undefined);
  expect(requests).toHaveLength(1);
  const all = [];
  for await (const item of group.messages({ limit: 1 })) all.push(item.id);
  expect(all).toEqual(['message', 'older']);
  expect(new URL(requests[2].url).searchParams.get('before')).toBe('message');
});

test('read cursors and permission changes use standalone routes and reject cross-group messages', async () => {
  const { macro, group, requests } = fixture(
    () => new Response(null, { status: 204 }),
  );
  await group.markRead(WhatsAppMessage.byId(macro._client, group, 'message'));
  expect(await requests[0].json()).toEqual({ message_id: 'message' });
  await group.updatePermissions({ teamShareAccessLevel: 'view' });
  expect(requests[1].method).toBe('PATCH');
  expect(new URL(requests[1].url).pathname).toBe(
    '/meta/linked/whatsapp-groups/group/permissions',
  );
  const other = macro.whatsapp.byId('other');
  await expect(
    group.markRead(WhatsAppMessage.byId(macro._client, other, 'message')),
  ).rejects.toThrow('another group');
  expect(requests).toHaveLength(2);
});

test('owner-token send preserves intent and unknown delivery is read without resending', async () => {
  const { group, requests } = fixture((request) =>
    Response.json(
      request.method === 'POST' &&
        new URL(request.url).pathname.endsWith('/sends')
        ? progress
        : [progress],
    ),
  );
  const sent = await group.reply(
    { type: 'text', text: 'hello' },
    { idempotencyKey: 'stable' },
  );
  expect(sent).toBeInstanceOf(WhatsAppSend);
  expect(sent.group.id).toBe('group');
  expect(await sent.state()).toBe('unknown');
  expect(await requests[0].json()).toEqual({
    idempotency_key: 'stable',
    message: { type: 'text', text: 'hello' },
  });
  await sent.refresh();
  expect(await sent.state()).toBe('unknown');
  expect(
    requests.filter(
      (request) =>
        new URL(request.url).pathname.endsWith('/sends') &&
        request.method === 'POST',
    ),
  ).toHaveLength(1);
});

test('staged uploads stay scoped to their adopted group and carry no credentials', async () => {
  const { macro, group, requests } = fixture(() =>
    Response.json({
      upload_id: 'upload',
      filename: 'note.txt',
      kind: 'document',
    }),
  );
  const upload = await group.upload(
    new File(['hello'], 'note.txt', { type: 'text/plain' }),
  );
  expect(upload).toBeInstanceOf(WhatsAppUpload);
  expect(upload.groupId).toBe(group.id);
  expect(JSON.stringify(upload)).not.toContain('owner-api-token');
  const other = WhatsAppUpload.byId(
    macro.whatsapp.byId('other'),
    'other-upload',
  );
  await expect(
    group.reply({ type: 'media', upload: other }, { idempotencyKey: 'stable' }),
  ).rejects.toThrow('another group');
  expect(requests).toHaveLength(1);
});

test('mutations and replies accept only standalone WhatsApp messages', async () => {
  const { macro, group, requests } = fixture(() => Response.json(progress));
  const target = WhatsAppMessage.byId(macro._client, group, 'message');
  await group.reply(
    { type: 'mutation', message: target, operation: 'reaction', text: '👍' },
    { idempotencyKey: 'reaction' },
  );
  expect(await requests[0].json()).toEqual({
    idempotency_key: 'reaction',
    message: {
      type: 'mutation',
      message_id: 'message',
      operation: 'reaction',
      text: '👍',
    },
  });
});
