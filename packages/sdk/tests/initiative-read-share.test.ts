import { afterEach, expect, test } from 'bun:test';
import { Macro } from '../src/macro';

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

type Seen = { method: string; path: string; query: string; body: unknown };

function record(respond: (request: Seen) => Response): Seen[] {
  const requests: Seen[] = [];
  globalThis.fetch = Object.assign(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      const url = new URL(request.url);
      const text = await request.text();
      const seen = {
        method: request.method,
        path: url.pathname,
        query: url.search,
        body: text ? JSON.parse(text) : undefined,
      };
      requests.push(seen);
      return respond(seen);
    },
    { preconnect: originalFetch.preconnect },
  );
  return requests;
}

const macro = () =>
  new Macro({ token: 'token', hosts: { storage: 'https://storage.test' } });

test('Initiative.read returns properties, description and a task page as handles', async () => {
  const requests = record(() =>
    Response.json({
      id: 'initiative-1',
      name: 'Launch',
      ownerId: 'macro|owner@example.com',
      memberIds: ['macro|member@example.com'],
      taskIds: ['task-1'],
      sharePermission: { isPublic: false, publicAccessLevel: null },
      userAccessLevel: 'edit',
      createdAt: '2026-11-01T00:00:00Z',
      updatedAt: '2026-11-02T00:00:00Z',
      properties: {
        status: '00000001-0000-0000-0002-000000000002',
        priority: null,
        assignees: ['macro|member@example.com'],
        dueDate: '2026-12-01T00:00:00Z',
        completed: false,
      },
      description: '# Goals',
      taskCount: 3,
      nextTaskCursor: 'task-1',
    }),
  );
  const overview = await macro()
    .initiatives.byId('initiative-1')
    .read({ taskLimit: 1 });

  expect(requests[0]?.path).toBe('/initiatives/initiative-1/overview');
  expect(requests[0]?.query).toBe('?taskLimit=1');
  expect(overview.status).toBe('in_progress');
  expect(overview.priority).toBeUndefined();
  expect(overview.assignees.map((user) => user.id)).toEqual([
    'macro|member@example.com',
  ]);
  expect(overview.owner.id).toBe('macro|owner@example.com');
  expect(overview.description).toBe('# Goals');
  expect(overview.tasks.map((task) => task.id)).toEqual(['task-1']);
  expect(overview.taskCount).toBe(3);
  expect(overview.nextTaskCursor).toBe('task-1');
});

test('Channel.share writes the grant for each kind of item', async () => {
  const requests = record(() => new Response(null, { status: 204 }));
  const client = macro();
  const channel = client.channels.byId('channel-1');

  await channel.share(client.documents.byId('document-1'));
  await channel.share(client.email.byId('thread-1'));

  expect(requests).toEqual([
    {
      method: 'POST',
      path: '/channels/channel-1/shares',
      query: '',
      body: { entityType: 'document', entityId: 'document-1' },
    },
    {
      method: 'POST',
      path: '/channels/channel-1/shares',
      query: '',
      body: { entityType: 'thread', entityId: 'thread-1' },
    },
  ]);
});
