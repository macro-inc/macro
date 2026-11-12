import { afterEach, describe, expect, test } from 'bun:test';
import { Macro } from '../src/macro';

const originalFetch = globalThis.fetch;
const host = 'https://storage.example.test';
const initiativeId = '01a17930-ca75-7cd0-97e5-233140b4e491';
const otherId = '01a1793c-85f8-7961-885a-1718b0f00de5';
const rootId = '01a19e94-0140-7500-b685-6089ecb38db1';
const replyId = '01a19e94-0140-7500-b685-6089ecb38db2';
const userId = 'macro|owner@macro.com';

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function serve(handler: (request: Request) => Response | Promise<Response>) {
  const requests: Request[] = [];
  globalThis.fetch = (async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init);
    requests.push(request.clone());
    return handler(request);
  }) as typeof fetch;
  return requests;
}

function macro() {
  return new Macro({ token: 'user-token', hosts: { storage: host } });
}

function row(id: string, name: string) {
  return {
    id,
    name,
    updatedAt: '2026-11-01T10:00:00Z',
    userAccessLevel: 'edit',
    properties: {
      status: '00000001-0000-0000-0002-000000000002',
      priority: null,
      assignees: [userId],
      dueDate: '2026-11-30T00:00:00Z',
      completed: false,
    },
    taskCount: 4,
    completedTaskCount: 1,
  };
}

function message(content: string, threadId: string | null = null) {
  return {
    id: threadId ? replyId : rootId,
    parent: { type: 'initiative', id: initiativeId },
    sender_id: userId,
    content,
    thread_id: threadId,
    created_at: '2026-11-01T10:00:00Z',
    updated_at: '2026-11-01T10:00:00Z',
    deleted_at: null,
  };
}

describe('initiatives.list', () => {
  test('sends the filters on every page and maps rows to named properties', async () => {
    const requests = serve((request) => {
      const cursor = new URL(request.url).searchParams.get('cursor');
      return Response.json(
        cursor
          ? { initiatives: [row(otherId, 'Editing')], nextCursor: null }
          : { initiatives: [row(initiativeId, 'Agents')], nextCursor: 'p2' },
      );
    });

    const listings = [];
    for await (const listing of macro().initiatives.list({
      status: 'in_progress',
      priority: 'high',
      assignee: macro().users.byId(userId),
      dueBefore: new Date('2026-12-01T00:00:00Z'),
      sort: 'due',
    }))
      listings.push(listing);

    expect(
      listings.map((listing) => [
        listing.initiative.id,
        listing.name,
        listing.status,
        listing.priority,
        listing.assignees.map((user) => user.id),
        listing.dueDate,
        listing.taskCount,
        listing.completedTaskCount,
      ]),
    ).toEqual([
      [
        initiativeId,
        'Agents',
        'in_progress',
        undefined,
        [userId],
        '2026-11-30T00:00:00Z',
        4,
        1,
      ],
      [
        otherId,
        'Editing',
        'in_progress',
        undefined,
        [userId],
        '2026-11-30T00:00:00Z',
        4,
        1,
      ],
    ]);
    const urls = requests.map((request) => new URL(request.url));
    expect(urls.map((url) => url.pathname)).toEqual([
      '/initiatives/page',
      '/initiatives/page',
    ]);
    for (const url of urls)
      expect(url.searchParams.get('status')).toBe(
        '00000001-0000-0000-0002-000000000002',
      );
    expect(Object.fromEntries(urls[1]?.searchParams ?? [])).toEqual({
      status: '00000001-0000-0000-0002-000000000002',
      priority: '00000001-0000-0000-0003-000000000003',
      assignee: userId,
      dueBefore: '2026-12-01T00:00:00.000Z',
      sort: 'due',
      cursor: 'p2',
    });
  });

  test('rejects an option the SDK does not know', async () => {
    serve(() =>
      Response.json({
        initiatives: [
          {
            ...row(initiativeId, 'Agents'),
            properties: {
              ...row(initiativeId, 'Agents').properties,
              status: 'x',
            },
          },
        ],
        nextCursor: null,
      }),
    );
    const listings = macro().initiatives.list();
    await expect(listings.next()).rejects.toThrow('Unknown Status option x');
  });
});

describe('Initiative', () => {
  test('description reads the markdown', async () => {
    const requests = serve(() => Response.json({ markdown: '## Goals' }));

    await expect(
      macro().initiatives.byId(initiativeId).description(),
    ).resolves.toBe('## Goals');
    expect(new URL(requests[0]?.url ?? '').pathname).toBe(
      `/initiatives/${initiativeId}/description`,
    );
  });

  test('discussion comments list, post and reply through message routes', async () => {
    const path = `/messages/initiative/${initiativeId}`;
    const root = message('Kickoff notes');
    const reply = message('Sounds good', rootId);
    const state = {
      root_id: rootId,
      resolved: false,
      owner_id: userId,
      created_at: '2026-11-01T10:00:00Z',
      updated_at: '2026-11-01T10:00:00Z',
    };
    const requests = serve(async (request) => {
      const url = new URL(request.url);
      if (url.pathname === `${path}/threads/${rootId}`)
        return Response.json({ state, root, replies: [reply] });
      if (url.pathname === path && request.method === 'GET')
        return Response.json({
          items: [{ ...root, reply_count: 1 }],
          next_cursor: null,
        });
      if (url.pathname === path && request.method === 'POST') {
        const body = await request.json();
        return Response.json(body.thread_id ? reply : root);
      }
      return new Response(null, { status: 404 });
    });
    const initiative = macro().initiatives.byId(initiativeId);

    const threads = await initiative.comments();
    expect(
      threads[0]?.comments.map((comment) => [comment.id, comment.parent]),
    ).toEqual([
      [rootId, { type: 'initiative', id: initiativeId }],
      [replyId, { type: 'initiative', id: initiativeId }],
    ]);
    await expect(threads[0]?.comments[1]?.text()).resolves.toBe('Sounds good');

    const created = await initiative.comment('Kickoff notes');
    await created.reply('Sounds good');

    const writes = requests.filter((request) => request.method === 'POST');
    expect(writes.map((request) => new URL(request.url).pathname)).toEqual([
      path,
      path,
    ]);
    expect(await writes[1]?.json()).toMatchObject({
      content: 'Sounds good',
      thread_id: rootId,
    });
  });
});
