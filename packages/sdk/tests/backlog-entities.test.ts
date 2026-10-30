import { afterEach, expect, test } from 'bun:test';
import type { ParsedMessage } from '../generated/email/types.gen';
import type {
  AccessiblePipeline,
  AccessRequest,
  Meeting,
  TableDetail,
} from '../generated/storage/types.gen';
import { DraftAttachment, Macro } from '../src/macro';
import { MacroApiError } from '../src/utils';

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

const draftMessage: ParsedMessage = {
  db_id: 'draft-1',
  link_id: 'secondary-inbox',
  thread_db_id: 'thread-1',
  bcc: [],
  cc: [],
  to: [],
  labels: [],
  draft_generation: 2,
};

test('draft editing encodes Unicode HTML and every write stays in the draft inbox', async () => {
  const writes: Request[] = [];
  globalThis.fetch = Object.assign(
    async (input: RequestInfo | URL) => {
      const request = input instanceof Request ? input : new Request(input);
      if (request.method === 'GET') return Response.json(draftMessage);
      writes.push(request);
      if (request.headers.get('X-Email-Link-Id') !== 'secondary-inbox')
        return Response.json({ error: 'wrong inbox' }, { status: 403 });
      if (new URL(request.url).pathname.endsWith('/attachments'))
        return Response.json({
          attachment_id: 'attachment-1',
          upload_url: 'https://uploads.test/file',
          content_type: 'text/plain',
        });
      if (new URL(request.url).pathname.endsWith('/forwarded-attachments'))
        return Response.json({ attachment_id: 'attachment-2' });
      if (request.url.endsWith('/drafts'))
        return Response.json({
          draft: {
            db_id: 'draft-1',
            link_id: 'secondary-inbox',
            subject: 'Updated',
          },
        });
      return new Response(null, { status: 204 });
    },
    { preconnect: originalFetch.preconnect },
  );
  const macro = new Macro({
    token: 'token',
    hosts: { email: 'https://email.test' },
  });
  const draft = macro.email.draftById('draft-1');
  expect(await draft.draftGeneration()).toBe(2);
  await draft.update({
    subject: 'Updated',
    bodyHtml: '<p>café ☕</p>',
    thread: macro.email.byId('thread-1'),
    replyingTo: macro.email.message('message-1'),
  });
  expect(await writes[0].json()).toEqual({
    draft: {
      db_id: 'draft-1',
      draft_generation: 2,
      subject: 'Updated',
      body_html: Buffer.from('<p>café ☕</p>').toString('base64url'),
      thread_db_id: 'thread-1',
      replying_to_id: 'message-1',
    },
  });
  const upload = await draft.addAttachment({
    fileName: 'notes.txt',
    sha: 'abc',
    size: 12,
  });
  expect(upload.attachment.draft).toBe(draft);
  await upload.attachment.complete();
  await upload.attachment.remove();
  const forwarded = await draft.forwardAttachment(
    macro.email.attachment('source-attachment'),
  );
  await forwarded.remove();
  await draft.schedule('2026-11-01T09:00:00Z');
  await draft.unschedule();
  await draft.delete();
  expect(writes).toHaveLength(9);
  expect(
    writes
      .slice(1)
      .every(
        (request) =>
          new URL(request.url).searchParams.get('draft_generation') === '2',
      ),
  ).toBe(true);
  expect(
    writes.every((r) => r.headers.get('X-Email-Link-Id') === 'secondary-inbox'),
  ).toBe(true);
  expect(JSON.stringify(upload.attachment)).toBe(
    '{"id":"attachment-1","draftId":"draft-1","forwarded":false,"draftGeneration":2}',
  );
});

test('attachments cannot be removed through a different draft', async () => {
  let requests = 0;
  globalThis.fetch = Object.assign(
    async () => {
      requests++;
      return new Response(null, { status: 204 });
    },
    { preconnect: originalFetch.preconnect },
  );
  const macro = new Macro({ token: 'token' });
  const first = macro.email.draftById('one');
  const second = macro.email.draftById('two');
  const attachment = DraftAttachment.byId(macro._client, first, 'attachment');
  await expect(second.removeAttachment(attachment)).rejects.toThrow(
    'another draft',
  );
  expect(requests).toBe(0);
});

test('scheduled draft iteration is lazy, keeps inbox selection, and stops on break', async () => {
  const requests: Request[] = [];
  globalThis.fetch = Object.assign(
    async (input: RequestInfo | URL) => {
      const request = input instanceof Request ? input : new Request(input);
      requests.push(request);
      const offset = new URL(request.url).searchParams.get('offset');
      return Response.json({
        messages:
          offset === '0' ? [{ db_id: 'draft-1' }, { db_id: 'draft-2' }] : [],
      });
    },
    { preconnect: originalFetch.preconnect },
  );
  const macro = new Macro({
    token: 'token',
    hosts: { email: 'https://email.test' },
  });
  const iterator = macro.email.scheduled({
    pageSize: 2,
    inbox: macro.email.link('secondary-inbox'),
  });
  expect(requests).toHaveLength(0);
  for await (const draft of iterator) {
    expect(draft.id).toBe('draft-1');
    break;
  }
  expect(requests).toHaveLength(1);
  expect(requests[0].headers.get('X-Email-Link-Id')).toBe('secondary-inbox');
  const all = await Array.fromAsync(
    macro.email.scheduled({
      pageSize: 2,
      inbox: macro.email.link('secondary-inbox'),
    }),
  );
  expect(all.map((d) => d.id)).toEqual(['draft-1', 'draft-2']);
  expect(new URL(requests[2].url).searchParams.get('offset')).toBe('2');
});

test('meeting mutations keep invitation lookup for channel and older meetings', async () => {
  const record: Meeting = {
    id: 'meeting-1',
    title: 'Standup',
    shareToken: 'invite-token',
    channelId: 'channel-1',
    callId: 'call-1',
  };
  const requests: Request[] = [];
  globalThis.fetch = Object.assign(
    async (input: RequestInfo | URL) => {
      const request = input instanceof Request ? input : new Request(input);
      requests.push(request);
      if (request.method === 'PATCH') record.title = 'New title';
      if (request.url.endsWith('/meetings'))
        return Response.json({ meetings: [] });
      return Response.json(record);
    },
    { preconnect: originalFetch.preconnect },
  );
  const macro = new Macro({
    token: 'token',
    webAppUrl: 'https://web.test',
    hosts: { storage: 'https://storage.test' },
  });
  const meeting = await macro.meetings.lookup('invite-token');
  expect((await meeting.channel())?.id).toBe('channel-1');
  await meeting.update({ title: 'New title' });
  expect(await meeting.title()).toBe('New title');
  expect(await meeting.webUrl()).toBe(
    'https://web.test/app/meet/join/invite-token',
  );
  expect(requests.map((r) => new URL(r.url).pathname)).toEqual([
    '/call/join/invite-token',
    '/call/meetings/meeting-1',
    '/call/join/invite-token',
  ]);
});

const requestRecord: AccessRequest = {
  id: 'request-1',
  createdAt: '',
  updatedAt: '',
  requesterId: 'macro|requester@example.test',
  requestedLevel: 'view',
  revision: 4,
  status: 'pending',
};
test('access resolution preserves the resolved snapshot when pending listings no longer include it', async () => {
  const writes: Request[] = [];
  let resolved = false;
  globalThis.fetch = Object.assign(
    async (input: RequestInfo | URL) => {
      const request = input instanceof Request ? input : new Request(input);
      if (request.method === 'POST') {
        writes.push(request);
        resolved = true;
        return Response.json({
          ...requestRecord,
          status: 'granted',
          revision: 5,
          grantedLevel: 'view',
        });
      }
      return Response.json({
        canReview: true,
        pendingCount: resolved ? 0 : 1,
        supportedLevels: ['view'],
        requests: resolved ? [] : [requestRecord],
      });
    },
    { preconnect: originalFetch.preconnect },
  );
  const macro = new Macro({
    token: 'token',
    hosts: { storage: 'https://storage.test' },
  });
  const access = macro.documents.byId('doc-1').access;
  const [request] = (await access.state()).requests;
  expect((await request.requester()).id).toBe(requestRecord.requesterId);
  await request.resolve('view');
  expect(await request.status()).toBe('granted');
  expect(await request.revision()).toBe(5);
  expect((await access.state()).requests).toHaveLength(0);
  expect(await writes[0].json()).toEqual({ revision: 4, grantedLevel: 'view' });
  expect(new URL(writes[0].url).pathname).toBe(
    '/entities/document/doc-1/access-requests/request-1/resolve',
  );
});

test('API key metadata serialization excludes creation secrets and deletion errors propagate', async () => {
  globalThis.fetch = Object.assign(
    async (input: RequestInfo | URL) => {
      const request = input instanceof Request ? input : new Request(input);
      if (request.method === 'DELETE')
        return Response.json({ error: 'denied' }, { status: 403 });
      return Response.json(
        { id: 'key-1', name: 'Automation', createdAt: '', key: 'mak_secret' },
        { status: 201 },
      );
    },
    { preconnect: originalFetch.preconnect },
  );
  const macro = new Macro({
    token: 'caller-token',
    hosts: { storage: 'https://storage.test' },
  });
  const created = await macro.apiKeys.create('Automation');
  expect(created.secret).toBe('mak_secret');
  expect(await created.key.name()).toBe('Automation');
  expect(JSON.stringify(created.key)).not.toContain('mak_secret');
  expect(JSON.stringify(created.key)).not.toContain('caller-token');
  await expect(created.key.delete()).rejects.toBeInstanceOf(MacroApiError);
});

test('pairing claims distinguish pending responses and expose credentials separately from handles', async () => {
  let pending = true;
  const requests: Request[] = [];
  globalThis.fetch = Object.assign(
    async (input: RequestInfo | URL) => {
      const request = input instanceof Request ? input : new Request(input);
      requests.push(request);
      if (request.url.endsWith('/claim'))
        return pending
          ? Response.json({ status: 'pending' }, { status: 202 })
          : Response.json({
              harness: { id: 'host-1', name: 'Laptop' },
              token: 'host-secret',
            });
      return Response.json(
        {
          pairing_id: 'pairing-1',
          code: 'CODE',
          device_secret: 'device-secret',
          expires_at: '',
          poll_interval_seconds: 5,
        },
        { status: 201 },
      );
    },
    { preconnect: originalFetch.preconnect },
  );
  const macro = new Macro({
    token: 'token',
    hosts: { storage: 'https://storage.test' },
  });
  const created = await macro.harnesses.createPairing({ name: 'Laptop' });
  expect(await created.device.claim(created.deviceSecret)).toBeUndefined();
  pending = false;
  const claimed = await created.device.claim(created.deviceSecret);
  expect(claimed?.harness.id).toBe('host-1');
  expect(claimed?.token).toBe('host-secret');
  expect(JSON.stringify(created.device)).not.toContain('device-secret');
  expect(JSON.stringify(claimed?.harness)).not.toContain('host-secret');
  expect(await requests[1].json()).toEqual({ device_secret: 'device-secret' });
});

const pipelineRecord: AccessiblePipeline = {
  id: 'pipeline-1',
  name: 'Sales',
  databaseId: 'database-1',
  tableId: 'table-1',
  primaryColumnId: 'column-1',
  recordType: 'company',
  sharing: 'team',
  grant: 'edit',
  teamId: 'team-1',
  userId: 'owner-1',
  createdAt: '',
  trashedAt: null,
};
const tableRecord: TableDetail = {
  table: {
    id: 'table-1',
    database_id: 'database-1',
    name: 'Sales',
    position: 'a',
    version: 1,
  },
  columns: [],
  views: [],
  sql_name: 'sales',
};
test('pipeline reads and ops stay under its sharing boundary and invalidate the shared table cache', async () => {
  const requests: Request[] = [];
  let version = 1;
  globalThis.fetch = Object.assign(
    async (input: RequestInfo | URL) => {
      const request = input instanceof Request ? input : new Request(input);
      requests.push(request);
      if (request.url.endsWith('/ops')) {
        version++;
        return Response.json({ results: [], changes: [] });
      }
      if (request.url.endsWith('/table'))
        return Response.json({
          ...tableRecord,
          table: { ...tableRecord.table, version },
        });
      if (request.url.includes('/rows'))
        return Response.json({
          version,
          rows: [{ rowId: 'row-1', cells: {} }],
        });
      return Response.json(pipelineRecord);
    },
    { preconnect: originalFetch.preconnect },
  );
  const macro = new Macro({
    token: 'token',
    hosts: { storage: 'https://storage.test' },
  });
  const pipeline = macro.crm.pipelines.byId('pipeline-1');
  expect(await pipeline.name()).toBe('Sales');
  const table = await pipeline.table();
  expect(await table.version()).toBe(1);
  expect(await table.version()).toBe(1);
  expect(requests).toHaveLength(2);
  await pipeline.applyOps([], { baseVersions: [{ table, version: 1 }] });
  expect(await table.version()).toBe(2);
  expect(await requests[2].json()).toEqual({
    ops: [],
    baseVersions: { 'table-1': 1 },
  });
  const [row] = await Array.fromAsync(
    pipeline.queryRows({ rows: [table.rowById('row-1')] }),
  );
  expect(await row.cells()).toEqual({});
  expect(row.pipeline).toBe(pipeline);
  expect(JSON.stringify(row)).toContain('"pipelineId":"pipeline-1"');
  expect(
    requests.every((r) =>
      new URL(r.url).pathname.startsWith('/crm/pipelines/pipeline-1'),
    ),
  ).toBe(true);
  const before = requests.length;
  await expect(
    macro.crm.pipelines
      .byId('pipeline-2')
      .applyOps([], { baseVersions: [{ table, version: 2 }] }),
  ).rejects.toThrow('another pipeline');
  expect(requests).toHaveLength(before);
});

test('typed sharing grants translate channel handles and preserve explicit grant clearing', async () => {
  const writes: Request[] = [];
  globalThis.fetch = Object.assign(
    async (input: RequestInfo | URL) => {
      const request = input instanceof Request ? input : new Request(input);
      writes.push(request);
      return Response.json({ id: 'permissions-1', owner: 'owner' });
    },
    { preconnect: originalFetch.preconnect },
  );
  const macro = new Macro({
    token: 'token',
    hosts: {
      'agent-harness': 'https://agents.test',
      storage: 'https://storage.test',
    },
  });
  await macro.agentSessions.byId('session-1').updateSharePermissions({
    channelSharePermissions: [
      {
        channel: macro.channels.byId('channel-1'),
        operation: 'add',
        accessLevel: 'view',
      },
    ],
  });
  expect(await writes[0].json()).toEqual({
    channelSharePermissions: [
      { channelId: 'channel-1', operation: 'add', accessLevel: 'view' },
    ],
  });
  await macro.crm.pipelines
    .byId('pipeline-1')
    .updateSharePermissions({ channelSharePermissions: null });
  expect(await writes[1].json()).toEqual({ channelSharePermissions: null });
});

test('team slug lookup validates the actual document response rather than trusting the colliding generated schema', async () => {
  let malformed = false;
  globalThis.fetch = Object.assign(
    async () =>
      Response.json(
        malformed
          ? { data: { items: [] } }
          : { data: { documentMetadata: { documentId: 'task-1' } } },
      ),
    { preconnect: originalFetch.preconnect },
  );
  const macro = new Macro({
    token: 'token',
    hosts: { storage: 'https://storage.test' },
  });
  expect((await macro.documents.byTeamSlug('ENG-42')).id).toBe('task-1');
  malformed = true;
  await expect(macro.documents.byTeamSlug('ENG-42')).rejects.toThrow(
    'Invalid team task document response',
  );
});

test('chat send receipts expose a scoped response message and cancellation never retries', async () => {
  const requests: Request[] = [];
  globalThis.fetch = Object.assign(
    async (input: RequestInfo | URL) => {
      const request = input instanceof Request ? input : new Request(input);
      requests.push(request);
      if (request.url.endsWith('/stop'))
        return Response.json({ error: 'forbidden' }, { status: 403 });
      if (request.method === 'GET')
        return Response.json({
          chat: {
            messages: [
              {
                id: 'response-1',
                content: 'Hello',
                role: 'assistant',
                attachments: [],
              },
            ],
          },
        });
      return Response.json({
        chat_id: 'chat-1',
        message_id: 'response-1',
        stream_id: 'stream-1',
      });
    },
    { preconnect: originalFetch.preconnect },
  );
  const macro = new Macro({
    token: 'token',
    hosts: { cognition: 'https://ai.test' },
  });
  const generation = await macro.chats.byId('chat-1').send({
    content: 'Hello',
    model: 'model',
    toolset: { type: 'none' },
    attachments: [{ type: 'document', entity: macro.documents.byId('doc-1') }],
  });
  expect(generation.chat.id).toBe('chat-1');
  expect(generation.message.id).toBe('response-1');
  expect(await generation.message.content()).toBe('Hello');
  expect(await requests[0].json()).toEqual({
    chat_id: 'chat-1',
    content: 'Hello',
    model: 'model',
    toolset: { type: 'none' },
    attachments: [{ entity_id: 'doc-1', entity_type: 'document' }],
  });
  await expect(generation.stop()).rejects.toBeInstanceOf(MacroApiError);
  expect(requests).toHaveLength(3);
  expect(await requests[2].json()).toEqual({
    chat_id: 'chat-1',
    stream_id: 'stream-1',
  });
});
