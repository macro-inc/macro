import { afterEach, describe, expect, test } from 'bun:test';
import type {
  Bot,
  Message,
  MessageListItem,
  MessageThread,
} from '../generated/storage/types.gen';
import { Macro, msg } from '../src/macro';

const originalFetch = globalThis.fetch;
const host = 'https://storage.example.test';
const channelId = '0198a4cc-e138-7670-a308-a6b766602700';
const documentId = '0198a4cc-e138-7670-a308-a6b766602701';
const rootId = '0198a4cc-e138-7670-a308-a6b766602702';
const replyId = '0198a4cc-e138-7670-a308-a6b766602703';
const timestamp = '2026-09-09T12:00:00Z';

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function message(overrides: Partial<Message> = {}): Message {
  return {
    id: rootId,
    parent: { type: 'channel', id: channelId },
    sender_id: 'macro|owner@example.com',
    content: 'A shared message',
    mentions: [],
    attachments: [],
    reactions: [],
    created_at: timestamp,
    updated_at: timestamp,
    ...overrides,
  };
}

function thread(root: Message, replies: Message[] = []): MessageThread {
  return {
    root,
    replies,
    state: {
      root_id: root.id,
      user_id: root.sender_id,
      anchor: null,
      resolved: false,
      created_at: timestamp,
      updated_at: timestamp,
    },
  };
}

function listItem(full: MessageThread): MessageListItem {
  return {
    ...full.root,
    state: full.state,
    thread: {
      reply_count: full.replies.length,
      preview: full.replies.slice(-3),
      latest_reply_at: full.replies.at(-1)?.created_at ?? null,
    },
  };
}

function serve(handler: (request: Request) => Response | Promise<Response>) {
  const requests: Request[] = [];
  globalThis.fetch = (async (input) => {
    const request = input instanceof Request ? input : new Request(input);
    requests.push(request.clone());
    return handler(request);
  }) as typeof fetch;
  return requests;
}

function macro() {
  return new Macro({ token: 'user-token', hosts: { storage: host } });
}

describe('shared message API contracts', () => {
  test('channel posts, lazy reads, edits, reactions, and deletes use message routes', async () => {
    let record = message();
    const path = `/messages/channel/${channelId}`;
    const requests = serve(async (request) => {
      const url = new URL(request.url);
      if (request.method === 'POST' && url.pathname === path) {
        const body = await request.json();
        expect(body.thread_id).toBeNull();
        expect(body.nonce).toBeString();
        record = message({ content: body.content, mentions: body.mentions });
        return Response.json(record);
      }
      if (url.pathname === `${path}/items/${rootId}`) {
        if (request.method === 'PATCH') {
          record = { ...record, ...(await request.json()) };
        }
        if (request.method === 'DELETE') {
          record = { ...record, deleted_at: timestamp, content: '' };
        }
        return Response.json(record);
      }
      if (url.pathname === `${path}/items/${rootId}/reactions`) {
        return Response.json(record);
      }
      return new Response(null, { status: 404 });
    });
    const client = macro();
    const user = client.users.byId('macro|colleague@example.com');
    const body = msg`Hello ${user}`;
    const posted = await client.channels.byId(channelId).send(body);
    expect(posted.id).toBe(rootId);
    await expect(posted.content()).resolves.toBe(body.content);
    await posted.edit('Edited');
    await expect(posted.content()).resolves.toBe('Edited');
    await posted.react('👍');
    await posted.unreact('👍');
    await posted.delete();

    expect(requests.map((request) => request.method)).toEqual([
      'POST',
      'GET',
      'PATCH',
      'GET',
      'POST',
      'POST',
      'DELETE',
    ]);
    expect(
      requests.every(
        (r) => r.headers.get('authorization') === 'Bearer user-token',
      ),
    ).toBe(true);
    await expect(requests[0]?.json()).resolves.toMatchObject(body);
    await expect(requests[4]?.json()).resolves.toEqual({
      emoji: '👍',
      add: true,
    });
    await expect(requests[5]?.json()).resolves.toEqual({
      emoji: '👍',
      add: false,
    });
  });

  test('channel timeline carries structured cursors and seeds shared message records', async () => {
    const newer = message({ content: 'Newer' });
    const older = message({ id: replyId, content: 'Older' });
    const cursor = { created_at: timestamp, id: newer.id };
    const requests = serve((request) => {
      const url = new URL(request.url);
      expect(url.pathname).toBe(`/messages/channel/${channelId}`);
      const selection = JSON.parse(url.searchParams.get('selection') ?? '{}');
      expect(selection.limit).toBe(1);
      if (selection.cursor) {
        expect(selection.cursor).toEqual(cursor);
        return Response.json({
          items: [listItem(thread(older))],
          next_cursor: null,
        });
      }
      return Response.json({
        items: [listItem(thread(newer))],
        next_cursor: cursor,
      });
    });
    const records = [];
    for await (const item of macro()
      .channels.byId(channelId)
      .messages({ pageSize: 1 })) {
      records.push({ id: item.id, content: await item.content() });
    }
    expect(records).toEqual([
      { id: rootId, content: 'Newer' },
      { id: replyId, content: 'Older' },
    ]);
    expect(requests).toHaveLength(2);
  });

  test('thread replies and typing use the root UUID and shared body shapes', async () => {
    const root = message();
    const reply = message({ id: replyId, content: 'Reply', thread_id: rootId });
    const path = `/messages/channel/${channelId}`;
    const requests = serve((request) => {
      const url = new URL(request.url);
      if (url.pathname === `${path}/threads/${rootId}`)
        return Response.json(thread(root, [reply]));
      if (url.pathname === path) return Response.json(reply);
      if (url.pathname === `${path}/typing`)
        return new Response(null, { status: 204 });
      return new Response(null, { status: 404 });
    });
    const channel = macro().channels.byId(channelId);
    const conversation = channel.message(rootId).thread();
    const replies = await conversation.replies();
    expect(replies.map((item) => item.id)).toEqual([replyId]);
    await expect(replies[0]?.content()).resolves.toBe('Reply');
    const posted = await conversation.reply('Next reply');
    expect(posted.id).toBe(replyId);
    await channel.typing('start', { thread: conversation });
    await channel.typing('stop');
    await expect(requests[1]?.json()).resolves.toMatchObject({
      content: 'Next reply',
      thread_id: rootId,
    });
    await expect(requests[2]?.json()).resolves.toEqual({
      active: true,
      thread_id: rootId,
    });
    await expect(requests[3]?.json()).resolves.toEqual({
      active: false,
      thread_id: null,
    });
  });

  test('document comments keep UUIDs and rich mentions through creation, editing, and replies', async () => {
    const parent = { type: 'document', id: documentId } as const;
    const path = `/messages/document/${documentId}`;
    let record = message({ parent });
    const requests = serve(async (request) => {
      const url = new URL(request.url);
      if (request.method === 'POST' && url.pathname === path) {
        const body = await request.json();
        record = message({
          parent,
          ...body,
          id: body.thread_id ? replyId : rootId,
        });
        return Response.json(record);
      }
      if (url.pathname === `${path}/items/${rootId}`) {
        if (request.method === 'PATCH')
          record = { ...record, ...(await request.json()) };
        return Response.json(record);
      }
      return new Response(null, { status: 404 });
    });
    const client = macro();
    const document = client.documents.byId(documentId);
    const body = msg`Please review ${client.users.byId('macro|colleague@example.com')}`;
    const comment = await document.comment(body);
    expect(comment.commentId).toBe(rootId);
    await expect(comment.threadId()).resolves.toBe(rootId);
    await expect(comment.text()).resolves.toBe(body.content);
    await comment.edit('Reviewed');
    await expect(comment.text()).resolves.toBe('Reviewed');
    const reply = await document.comment('A reply', {
      threadId: await comment.threadId(),
    });
    await expect(reply.threadId()).resolves.toBe(rootId);
    expect(reply.id).toBe(replyId);
    await comment.delete();
    expect(requests.map((request) => request.method)).toEqual([
      'POST',
      'PATCH',
      'GET',
      'POST',
      'DELETE',
    ]);
    await expect(requests[0]?.json()).resolves.toMatchObject(body);
    await expect(requests[1]?.json()).resolves.toEqual({
      content: 'Reviewed',
      mentions: [],
    });
    await expect(requests[3]?.json()).resolves.toMatchObject({
      thread_id: rootId,
    });
  });

  test('document comments include every root page and replies beyond the preview', async () => {
    const parent = { type: 'document', id: documentId } as const;
    const root = message({ parent });
    const secondRoot = message({ parent, id: replyId });
    const replies = Array.from({ length: 4 }, (_, index) =>
      message({
        parent,
        id: `reply-${index}`,
        thread_id: rootId,
        content: `Reply ${index}`,
      }),
    );
    const full = thread(root, replies);
    const cursor = { id: root.id, created_at: timestamp };
    const path = `/messages/document/${documentId}`;
    serve((request) => {
      const url = new URL(request.url);
      if (url.pathname === `${path}/threads/${rootId}`)
        return Response.json(full);
      if (url.pathname === `${path}/threads/${replyId}`)
        return Response.json(thread(secondRoot));
      if (url.pathname === path) {
        const selection = JSON.parse(url.searchParams.get('selection') ?? '{}');
        return Response.json(
          selection.cursor
            ? { items: [listItem(thread(secondRoot))], next_cursor: null }
            : { items: [listItem(full)], next_cursor: cursor },
        );
      }
      return new Response(null, { status: 404 });
    });
    const comments = await macro().documents.byId(documentId).comments();
    expect(comments.map(({ thread }) => thread.root_id)).toEqual([
      rootId,
      replyId,
    ]);
    expect(comments[0]?.comments.map((comment) => comment.id)).toEqual([
      rootId,
      ...replies.map(({ id }) => id),
    ]);
    await expect(comments[0]?.comments[1]?.text()).resolves.toBe('Reply 0');
  });

  test('team bot auth reaches shared posting while user-owned bots retain the webhook fallback', async () => {
    let owner: Bot['owner'] = { type: 'team', team_id: channelId };
    const requests = serve((request) => {
      const path = new URL(request.url).pathname;
      if (path === '/bots/me') return Response.json({ owner });
      if (path === `/messages/channel/${channelId}`)
        return Response.json(message());
      if (path === `/channels/${channelId}/webhook`)
        return Response.json({ message_id: rootId });
      return new Response(null, { status: 404 });
    });
    const team = new Macro({
      auth: { type: 'bot', token: 'mbot_team' },
      hosts: { storage: host },
    });
    await team.channels.byId(channelId).send('Team bot');
    expect(requests[1]?.headers.get('x-macro-bot-token')).toBe('mbot_team');
    expect(requests[1]?.headers.get('x-macro-bot-scope')).toBe('team');
    owner = { type: 'user', user_id: 'macro|owner@example.com' };
    const user = new Macro({
      auth: { type: 'bot', token: 'mbot_user' },
      hosts: { storage: host },
    });
    await user.channels.byId(channelId).send('User bot');
    expect(requests[3]?.headers.get('x-macro-bot-scope')).toBe('user');
    await expect(
      user.channels.byId(channelId).message(rootId).reply('Reply'),
    ).rejects.toThrow('does not support threads');
    expect(requests).toHaveLength(4);
  });
});
