import { afterEach, expect, test } from 'bun:test';
import type { TagSetResponse } from '../generated/properties/types.gen';
import type { SoupApiItem } from '../generated/storage/types.gen';
import { Macro, type WorkspaceType } from '../src/macro';

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});
const nil = '00000000-0000-0000-0000-000000000000';
const macro = () =>
  new Macro({
    token: 'test-token',
    hosts: {
      storage: 'https://storage.test',
      properties: 'https://properties.test',
      email: 'https://email.test',
    },
  });

function serve(handler: (request: Request) => Response | Promise<Response>) {
  globalThis.fetch = (async (input) =>
    handler(
      input instanceof Request ? input : new Request(input),
    )) as typeof fetch;
}

const document = (id = 'doc') => ({
  tag: 'document',
  data: {
    id,
    name: 'Launch',
    fileType: 'md',
    subType: { type: 'task', is_completed: true },
    properties: [],
  },
  frecency_score: 1,
  is_favorited: false,
});
const tagSets = [
  {
    scope: 'user',
    definition: { id: 'personal-def' },
    options: [
      { id: 'personal-option', value: { type: 'string', value: 'Launch' } },
    ],
  },
  {
    scope: 'team',
    definition: { id: 'team-def' },
    options: [
      { id: 'team-option', value: { type: 'string', value: 'Launch' } },
    ],
  },
] as TagSetResponse[];

test('workspace defaults use authenticated normal API with native defaults and generated snapshots', async () => {
  const requests: Request[] = [];
  serve(async (request) => {
    requests.push(request);
    expect(request.method).toBe('POST');
    expect(new URL(request.url).pathname).toBe('/items/soup/ast');
    expect(request.headers.get('authorization')).toBe('Bearer test-token');
    expect(await request.json()).toEqual({
      ccf: { l: { id: nil } },
      expand: true,
      limit: 50,
      sort_method: 'updated_at',
      sort_direction: 'desc',
      emailView: 'inbox',
    });
    return Response.json({ items: [document()], next_cursor: 'next-page' });
  });
  const page = await macro().workspace.page();
  expect(page.hasMore).toBe(true);
  expect(page.nextCursor).toBe('next-page');
  const item = page.items[0];
  expect(item.type).toBe('document');
  if (item.type !== 'document') throw new Error('expected document');
  expect(item.entity.id).toBe('doc');
  expect(item.name).toBe('Launch');
  expect(item.subType).toBe('task');
  expect(item.snapshot.data.subType).toEqual({
    type: 'task',
    is_completed: true,
  });
  expect(requests).toHaveLength(1);
});

test('each includeTypes selection uses the correct API deny literal for every other type', async () => {
  const filters = {
    document: ['df', 'id'],
    project: ['pf', 'pid'],
    ai_chat: ['cf', 'cid'],
    email: ['ef', 'ThreadId'],
    channel: ['chanf', 'ChannelId'],
    channel_thread: ['cthf', 'ThreadId'],
    call: ['callf', 'CallId'],
    calendar_event: ['calf', 'id'],
    foreign_entity: ['fef', 'id'],
  } as const;
  for (const type of Object.keys(filters) as WorkspaceType[]) {
    serve(async (request) => {
      const body = await request.json();
      for (const [other, [field, literal]] of Object.entries(filters))
        expect(body[field]).toEqual(
          other === type ? undefined : { l: { [literal]: nil } },
        );
      return Response.json({ items: [] });
    });
    await macro().workspace.page({ includeTypes: [type] });
  }
});

test('advanced AST task/date/channel/property filters pass through with explicit sort and bounded page size', async () => {
  const filters = {
    df: {
      '&': [
        { l: { dst: 'task' } },
        {
          '&': [
            { l: { ua: { gte: '2026-10-14T00:00:00Z' } } },
            { l: { ua: { lt: '2026-10-15T00:00:00Z' } } },
          ],
        },
      ],
    },
    propf: { l: { pd: 'status', et: 'TASK', v: { so: 'completed' } } },
    pf: { l: { pid: 'project' } },
    cf: { l: { cid: 'chat' } },
    ef: { l: { Read: false } },
    chanf: { l: { ChannelId: 'channel' } },
    cthf: { l: { ThreadId: 'thread' } },
    callf: { l: { Attended: true } },
    fef: { l: { id: 'foreign' } },
    calf: { l: { id: 'event' } },
  };
  serve(async (request) => {
    expect(new URL(request.url).searchParams.get('cursor')).toBe('resume/+');
    expect(await request.json()).toMatchObject({
      ...filters,
      favorites_only: true,
      limit: 500,
      sort_method: 'created_at',
      emailView: 'sent',
    });
    return Response.json({ items: [], next_cursor: null });
  });
  expect(
    (
      await macro().workspace.page({
        ...filters,
        cursor: 'resume/+',
        limit: 999,
        favoritesOnly: true,
        sortBy: 'recently_created',
        emailView: 'sent',
      })
    ).hasMore,
  ).toBe(false);
});

test('signal overrides email AST, resolves delegated inbox case-insensitively, and defaults to email only', async () => {
  const paths: string[] = [];
  serve(async (request) => {
    const path = new URL(request.url).pathname;
    paths.push(path);
    if (path.endsWith('/links'))
      return Response.json({
        links: [{ id: 'delegated-link', email_address: 'Team@Example.com' }],
      });
    expect(await request.json()).toMatchObject({
      df: { l: { id: nil } },
      ef: {
        '&': [
          { '&': [{ l: { Importance: true } }, { l: { Shared: 'exclude' } }] },
          { l: { Owner: 'delegated-link' } },
        ],
      },
      emailView: 'inbox',
    });
    return Response.json({ items: [] });
  });
  await macro().workspace.page({
    emailPreset: 'signal',
    ef: { l: { Read: true } },
    inbox: ' team@EXAMPLE.com ',
  });
  expect(paths).toHaveLength(2);
});

test('empty includeTypes and blank inbox preserve all types even with signal preset', async () => {
  let calls = 0;
  serve(async (request) => {
    calls++;
    const body = await request.json();
    expect(body.df).toBeUndefined();
    expect(body.ef).toEqual({
      '&': [{ l: { Importance: true } }, { l: { Shared: 'exclude' } }],
    });
    return Response.json({ items: [] });
  });
  await macro().workspace.page({
    includeTypes: [],
    emailPreset: 'signal',
    inbox: '  ',
  });
  expect(calls).toBe(1);
});

test('unknown and ambiguous inbox selectors fail before browsing', async () => {
  for (const links of [
    [],
    [
      { id: 'one', email_address: 'team@example.com' },
      { id: 'two', email_address: 'TEAM@example.com' },
    ],
  ]) {
    let calls = 0;
    serve(() => {
      calls++;
      return Response.json({ links });
    });
    await expect(
      macro().workspace.page({ inbox: 'team@example.com' }),
    ).rejects.toThrow(
      links.length ? 'Multiple connected inboxes' : 'No connected inbox',
    );
    expect(calls).toBe(1);
  }
});

test('tag any expands both scopes, trims labels, deduplicates options and ANDs existing properties', async () => {
  serve(async (request) => {
    if (new URL(request.url).hostname === 'properties.test')
      return Response.json(tagSets);
    expect((await request.json()).propf).toEqual({
      '&': [
        { l: { pd: 'priority', v: { so: 'high' } } },
        {
          '|': [
            { l: { pd: 'personal-def', v: { so: 'personal-option' } } },
            { l: { pd: 'team-def', v: { so: 'team-option' } } },
          ],
        },
      ],
    });
    return Response.json({ items: [] });
  });
  await macro().workspace.page({
    tags: [{ label: ' LAUNCH ' }, { label: 'launch' }],
    propf: { l: { pd: 'priority', v: { so: 'high' } } },
  });
});

test('tag all rejects ambiguity and unknown labels; scoped all preserves both requirements', async () => {
  let queries = 0;
  serve(async (request) => {
    if (new URL(request.url).hostname === 'properties.test')
      return Response.json(tagSets);
    queries++;
    expect((await request.json()).propf).toEqual({
      '&': [
        { l: { pd: 'personal-def', v: { so: 'personal-option' } } },
        { l: { pd: 'team-def', v: { so: 'team-option' } } },
      ],
    });
    return Response.json({ items: [] });
  });
  const sdk = macro();
  await expect(
    sdk.workspace.page({ tags: [{ label: 'Launch' }], tagsMatch: 'all' }),
  ).rejects.toThrow('ambiguous');
  await expect(
    sdk.workspace.page({ tags: [{ label: 'missing' }] }),
  ).rejects.toThrow('Available tags: Launch');
  await sdk.workspace.page({
    tags: [
      { label: 'launch', scope: 'personal' },
      { label: 'launch', scope: 'team' },
    ],
    tagsMatch: 'all',
  });
  expect(queries).toBe(1);
});

test('visible tag labels resolve for documents, calls and calendar without leaking other option IDs', async () => {
  let tagRequests = 0;
  const properties = [
    {
      definition: { data_type: 'TAG' },
      value: {
        type: 'SelectOption',
        value: ['team-option', 'unknown-option', 'team-option'],
      },
    },
    {
      definition: { data_type: 'SELECT_STRING' },
      value: { type: 'SelectOption', value: ['personal-option'] },
    },
  ];
  serve((request) => {
    if (new URL(request.url).hostname === 'properties.test') {
      tagRequests++;
      return Response.json(tagSets);
    }
    return Response.json({
      items: [
        { ...document(), data: { ...document().data, properties } },
        {
          tag: 'call',
          data: { callId: 'call', createdBy: 'user', properties },
        },
        {
          tag: 'calendarEvent',
          data: { id: 'event', title: 'Meeting', extra: { properties } },
        },
      ],
    });
  });
  const page = await macro().workspace.page({ tags: [{ label: 'launch' }] });
  expect(page.items.map((item) => item.tags)).toEqual(
    Array(3).fill([{ label: 'Launch', scope: 'team' }]),
  );
  expect(tagRequests).toBe(1);
});

test('all supported results retain metadata and correct handles without detail fetches', async () => {
  const data = [
    document(),
    { tag: 'chat', data: { id: 'chat', name: 'Chat', properties: [] } },
    {
      tag: 'project',
      data: { id: 'project', name: 'Project', properties: [] },
    },
    {
      tag: 'emailThread',
      data: {
        id: 'mail',
        name: 'Subject',
        snippet: 'Body preview',
        senderName: 'Ada',
        senderEmail: 'ada@example.com',
        inboxVisible: true,
        isRead: false,
        isDraft: true,
        properties: [],
      },
    },
    { tag: 'channel', data: { channel: { id: 'channel', name: 'Team' } } },
    {
      tag: 'channelThread',
      data: { id: 'root', channel_id: 'channel', content: 'Thread' },
    },
    {
      tag: 'call',
      data: { callId: 'call', createdBy: 'creator', properties: [] },
    },
    {
      tag: 'calendarEvent',
      data: {
        id: 'event',
        title: 'Meeting',
        status: 'confirmed',
        location: 'Room',
        conferenceUrl: 'https://meet.test',
        time: {},
        extra: { properties: [] },
      },
    },
    {
      tag: 'foreignEntity',
      data: {
        id: 'foreign',
        foreignEntityId: 'external',
        foreignEntitySource: 'linear',
        metadata: { title: 'Issue' },
      },
    },
  ];
  let calls = 0;
  serve(() => {
    calls++;
    return Response.json({ items: data });
  });
  const page = await macro().workspace.page();
  expect(page.items.map((item) => item.id)).toEqual([
    'doc',
    'chat',
    'project',
    'mail',
    'channel',
    'root',
    'call',
    'event',
    'foreign',
  ]);
  expect(page.items[3]).toMatchObject({
    type: 'email',
    subject: 'Subject',
    snippet: 'Body preview',
    senderEmail: 'ada@example.com',
    isDraft: true,
  });
  const thread = page.items[5];
  if (thread.type !== 'channel_thread') throw new Error('expected thread');
  expect(thread.entity.rootId).toBe('root');
  expect(thread.entity.channelId).toBe('channel');
  const serialized = JSON.stringify(page);
  expect(serialized).not.toContain('test-token');
  expect(JSON.parse(serialized).items[5].entity).toEqual({
    channelId: 'channel',
    rootId: 'root',
  });
  expect(page.items[7]).toMatchObject({
    title: 'Meeting',
    conferenceUrl: 'https://meet.test',
  });
  expect(page.items[8]).toMatchObject({
    foreignEntityId: 'external',
    metadata: { title: 'Issue' },
  });
  expect(calls).toBe(1);
});

test('iteration is lazy, preserves filters across cursors, and does not prefetch after break', async () => {
  let calls = 0;
  const cursors: Array<string | null> = [];
  serve(async (request) => {
    calls++;
    cursors.push(new URL(request.url).searchParams.get('cursor'));
    expect(await request.json()).toMatchObject({
      limit: 1,
      sort_method: 'viewed_at',
      df: { l: { dst: 'task' } },
    });
    return Response.json({
      items: [document(String(calls))],
      next_cursor: `page-${calls}`,
    });
  });
  const items = macro().workspace.list({
    limit: 0,
    sortBy: 'recently_viewed',
    df: { l: { dst: 'task' } },
  });
  expect(calls).toBe(0);
  const ids: string[] = [];
  for await (const item of items) {
    ids.push(item.id);
    if (ids.length === 2) break;
  }
  expect(calls).toBe(2);
  expect(cursors).toEqual([null, 'page-1']);
  expect(ids).toEqual(['1', '2']);
});

test('iterator follows empty pages, caches tag/inbox resolution, and rejects stalled cursors', async () => {
  let pages = 0;
  let tags = 0;
  let inboxes = 0;
  serve((request) => {
    const host = new URL(request.url).hostname;
    if (host === 'properties.test') {
      tags++;
      return Response.json(tagSets);
    }
    if (host === 'email.test') {
      inboxes++;
      return Response.json({
        links: [{ id: 'link', email_address: 'a@example.com' }],
      });
    }
    pages++;
    return Response.json({
      items: [],
      next_cursor: pages === 1 ? 'next' : null,
    });
  });
  expect(
    await Array.fromAsync(
      macro().workspace.list({
        tags: [{ label: 'Launch' }],
        inbox: 'a@example.com',
      }),
    ),
  ).toEqual([]);
  expect([pages, tags, inboxes]).toEqual([2, 1, 1]);
  serve(() => Response.json({ items: [], next_cursor: 'stalled' }));
  await expect(Array.fromAsync(macro().workspace.list())).rejects.toThrow(
    'cursor did not advance',
  );
});

test('transport failures, non-finite limits and unsupported response types fail explicitly', async () => {
  serve(() => Response.json({ message: 'forbidden' }, { status: 403 }));
  await expect(macro().workspace.page()).rejects.toThrow();
  await expect(macro().workspace.page({ limit: Infinity })).rejects.toThrow(
    'finite',
  );
  serve(() =>
    Response.json({
      items: [{ tag: 'crmCompany', data: { id: 'company' } } as SoupApiItem],
    }),
  );
  await expect(macro().workspace.page()).rejects.toThrow(
    'Unexpected workspace entity type',
  );
});

test('JavaScript option typos fail before requests instead of silently broadening filters', async () => {
  let requests = 0;
  serve(() => {
    requests++;
    return Response.json({ items: [] });
  });
  for (const options of [
    { includeTypes: ['emails'] },
    { emailPreset: 'important' },
    { sortBy: 'newest' },
    { tagsMatch: 'every' },
    { tags: [{ label: 'Launch', scope: 'everyone' }] },
  ]) {
    // Exercise untyped JavaScript, the code-mode caller's actual runtime surface.
    await expect(macro().workspace.page(options as never)).rejects.toThrow(
      'Invalid workspace',
    );
  }
  expect(requests).toBe(0);
});

test('unary conjunction from code mode fails locally with a repair instruction', async () => {
  let requests = 0;
  serve(() => {
    requests++;
    return Response.json({ items: [] });
  });
  await expect(
    macro().workspace.page({
      limit: 10,
      includeTypes: ['document'],
      df: { '&': [{ l: { dst: 'task' } }] },
    }),
  ).rejects.toThrow('df.&: expected exactly two expressions');
  for (const df of [
    { '&': [] },
    { '|': [{ l: {} }, { l: {} }, { l: {} }] },
    { '!': { '&': [{ l: {} }] } },
  ]) {
    await expect(macro().workspace.page({ df })).rejects.toThrow(
      'expected exactly two expressions',
    );
  }
  expect(requests).toBe(0);
});

test('valid task literals and nested binary filters are forwarded unchanged', async () => {
  const sent: unknown[] = [];
  serve(async (request) => {
    sent.push((await request.json()).df);
    return Response.json({ items: [] });
  });
  const filters = [
    { l: { dst: 'task' } },
    {
      '&': [
        { l: { dst: 'task' } },
        {
          '|': [
            { l: { ua: { gte: '2026-10-14T00:00:00Z' } } },
            { '!': { l: { ft: 'pdf' } } },
          ],
        },
      ],
    },
  ];
  for (const df of filters)
    await macro().workspace.page({ includeTypes: ['document'], df });
  expect(sent).toEqual(filters);
});

test('untyped workspace enum errors list the actual supported values', async () => {
  for (const type of ['calendar', 'chat', 'message_thread']) {
    await expect(
      macro().workspace.page({ includeTypes: [type] } as never),
    ).rejects.toThrow('call, calendar_event, foreign_entity');
    await expect(
      macro().workspace.page({ includeTypes: [type] } as never),
    ).rejects.toThrow('channel_thread');
  }
});
