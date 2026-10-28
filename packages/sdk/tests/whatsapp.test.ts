import { afterEach, expect, test } from 'bun:test';
import { ExternalChat, Macro, WhatsAppChat } from '../src/macro';

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

const account = {
  id: 'account',
  userId: 'owner',
  state: 'connected',
  identityJid: '15550000001@s.whatsapp.net',
  authorizationGeneration: 1,
};
const remote = { jid: '12036301@g.us' };

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
  return { macro, requests };
}

test('the chat list shows a chat someone else shared instead of adding it again', async () => {
  const { macro } = fixture(() =>
    Response.json({
      chats: [
        {
          jid: remote.jid,
          kind: 'group',
          name: 'Remote support',
          lastActivityAt: null,
          archived: false,
          pinned: false,
          added: null,
          shared: {
            id: 'theirs',
            name: 'Remote support',
            ownerId: 'macro|ana@example.com',
          },
          canAdd: false,
          cannotAddReason: null,
          community: null,
        },
        {
          jid: '12036399@g.us',
          kind: 'group',
          name: 'Neighbours',
          lastActivityAt: null,
          archived: false,
          pinned: false,
          added: null,
          shared: null,
          canAdd: false,
          cannotAddReason: 'community',
          community: null,
        },
      ],
    }),
  );
  const [shared, community] = await macro.whatsapp.chats();
  expect(await shared.added()).toBeUndefined();
  const theirs = await shared.shared();
  expect(theirs).toBeInstanceOf(ExternalChat);
  expect(theirs?.id).toBe('theirs');
  expect(await community.cannotAddReason()).toBe('community');
});

test('the chat list lists groups and direct chats and adds one as an external chat', async () => {
  const { macro, requests } = fixture((request) =>
    Response.json(
      request.method === 'POST'
        ? { chatId: 'chat' }
        : {
            chats: [
              {
                jid: '15558880001@s.whatsapp.net',
                kind: 'direct',
                name: 'Customer',
                lastActivityAt: '2026-10-22T10:00:00Z',
                archived: false,
                pinned: true,
                added: null,
                shared: null,
                canAdd: true,
                cannotAddReason: null,
                community: null,
              },
              {
                jid: remote.jid,
                kind: 'group',
                name: 'Remote support',
                lastActivityAt: null,
                archived: false,
                pinned: false,
                added: null,
                shared: null,
                canAdd: true,
                cannotAddReason: null,
                community: {
                  id: '12036399@g.us',
                  name: 'Neighbours',
                  announcements: false,
                },
              },
            ],
          },
    ),
  );
  const [direct, group] = await macro.whatsapp.chats();
  expect(await direct.kind()).toBe('direct');
  expect(await direct.canAdd()).toBe(true);
  expect(await group.canAdd()).toBe(true);
  expect((await group.community())?.name).toBe('Neighbours');
  expect((await group.community())?.chat.id).toBe('12036399@g.us');
  expect(await direct.community()).toBeUndefined();
  const added = await group.add();
  expect(added).toBeInstanceOf(ExternalChat);
  expect(added.id).toBe('chat');
  expect(requests.map((r) => new URL(r.url).pathname)).toEqual([
    '/whatsapp/chats',
    '/external-chats',
  ]);
  expect(await requests[1].json()).toEqual({
    provider: 'whatsapp',
    remoteId: remote.jid,
    kind: 'group',
  });
});

test('account access stays owner-scoped and no account normalizes to undefined', async () => {
  let current: unknown = { account: null };
  const { macro, requests } = fixture(() => Response.json(current));
  expect(await macro.whatsapp.account()).toBeUndefined();
  current = { account };
  expect((await macro.whatsapp.account())?.id).toBe('account');
  expect(new URL(requests[0].url).pathname).toBe('/whatsapp/account');
});

test('a chat handle reads its entry from the chat list', async () => {
  const { macro, requests } = fixture(() =>
    Response.json({
      chats: [
        {
          jid: remote.jid,
          kind: 'group',
          name: 'Remote support',
          lastActivityAt: null,
          archived: false,
          pinned: false,
          added: { id: 'chat', name: 'Remote support' },
          shared: null,
          canAdd: false,
          cannotAddReason: null,
          community: null,
        },
      ],
    }),
  );
  const chat = WhatsAppChat.byId(macro._client, remote.jid);
  expect((await chat.added())?.id).toBe('chat');
  expect(new URL(requests[0].url).pathname).toBe('/whatsapp/chats');
  await expect(
    WhatsAppChat.byId(macro._client, 'missing@g.us').name(),
  ).rejects.toThrow('not available');
});
