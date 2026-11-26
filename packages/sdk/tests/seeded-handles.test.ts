import { describe, expect, test } from 'bun:test';
import type { ApiThreadPreviewCursorInner } from '../generated/email/types.gen';
import type {
  ApiChannelWithLatest,
  DocumentMetadata,
} from '../generated/storage/types.gen';
import { ChannelNamespace } from '../src/entities/channels/namespace';
import { DocumentNamespace } from '../src/entities/documents/namespace';
import { EmailNamespace } from '../src/entities/email/namespace';
import type { MacroClient } from '../src/utils/client';

function channelRecord(
  id: string,
  channelType: ApiChannelWithLatest['channel_type'],
  name: string | null,
): ApiChannelWithLatest {
  return {
    id,
    name,
    auto_join_team: false,
    channel_type: channelType,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    is_participant: true,
    owner_id: 'macro|owner@example.com',
    participants: [],
  };
}

function channelsClient(records: ApiChannelWithLatest[]) {
  const detailRequests: string[] = [];
  const client = {
    storage: {
      getChannels: async () => ({
        data: { items: records, next_cursor: null },
      }),
      getChannel: async (options: { path: { channel_id: string } }) => {
        detailRequests.push(options.path.channel_id);
        return {
          data: {
            channel_id: options.path.channel_id,
            channel_name: 'Ada Lovelace',
            channel_type: 'direct_message',
            participants: [],
          },
        };
      },
      patchChannel: async () => ({ data: 'ok' }),
    },
  } as unknown as MacroClient;
  return { client, detailRequests };
}

describe('channel handles from channels.list()', () => {
  test('read a named channel name and type without a detail request', async () => {
    const { client, detailRequests } = channelsClient([
      channelRecord('channel-1', 'public', 'General'),
      channelRecord('channel-2', 'team', 'Engineering'),
    ]);

    const read = [];
    for await (const channel of new ChannelNamespace(client).list()) {
      read.push({ name: await channel.name(), type: await channel.type() });
    }

    expect(read).toEqual([
      { name: 'General', type: 'public' },
      { name: 'Engineering', type: 'team' },
    ]);
    expect(detailRequests).toEqual([]);
  });

  test('load the name the listing did not carry', async () => {
    const { client, detailRequests } = channelsClient([
      channelRecord('dm-1', 'direct_message', null),
    ]);

    const [channel] = await Array.fromAsync(
      new ChannelNamespace(client).list(),
    );

    expect(await channel?.type()).toBe('direct_message');
    expect(detailRequests).toEqual([]);
    expect(await channel?.name()).toBe('Ada Lovelace');
    expect(detailRequests).toEqual(['dm-1']);
  });

  test('a write drops the listed fields so the next read refetches', async () => {
    const { client, detailRequests } = channelsClient([
      channelRecord('channel-1', 'public', 'General'),
    ]);

    const [channel] = await Array.fromAsync(
      new ChannelNamespace(client).list(),
    );
    await channel?.rename('Renamed');
    await channel?.name();

    expect(detailRequests).toEqual(['channel-1']);
  });

  test('serialize as before: identity and link, no listed fields', async () => {
    const { client } = channelsClient([
      channelRecord('channel-1', 'public', 'General'),
    ]);

    const [channel] = await Array.fromAsync(
      new ChannelNamespace(client).list(),
    );

    expect(JSON.parse(JSON.stringify(channel))).toEqual({
      id: 'channel-1',
      url: expect.stringContaining('channel-1'),
    });
  });
});

test('channel name search hits carry their type', async () => {
  const detailRequests: string[] = [];
  const client = {
    search: {
      unifiedSearch: async () => ({
        data: {
          results: [
            {
              type: 'channel',
              id: 'channel-3',
              channel_id: 'channel-3',
              channel_type: 'private',
              highlight: { name: 'Design review', content: [] },
            },
          ],
          next_cursor: null,
        },
      }),
    },
    storage: {
      getChannel: async (options: { path: { channel_id: string } }) => {
        detailRequests.push(options.path.channel_id);
        return { data: {} };
      },
    },
  } as unknown as MacroClient;

  const [channel] = await Array.fromAsync(
    new ChannelNamespace(client).search('design'),
  );

  expect(await channel?.type()).toBe('private');
  expect(detailRequests).toEqual([]);
});

test('documents.recent() handles read listed metadata without a detail request', async () => {
  const detailRequests: string[] = [];
  const metadata: DocumentMetadata = {
    documentId: 'doc-1',
    documentName: 'Launch plan',
    documentVersionId: 3,
    owner: 'macro|owner@example.com',
    fileType: 'canvas',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-02T00:00:00Z',
    projectId: null,
  } as DocumentMetadata;
  const client = {
    storage: {
      getUserDocumentsHandler: async () => ({
        data: { data: { documents: [metadata], next_offset: null, total: 1 } },
      }),
      getDocument: async (options: { path: { document_id: string } }) => {
        detailRequests.push(options.path.document_id);
        return {
          data: {
            data: {
              documentMetadata: { ...metadata, projectId: 'project-1' },
            },
          },
        };
      },
    },
  } as unknown as MacroClient;

  const [document] = await Array.fromAsync(
    new DocumentNamespace(client).recent(),
  );

  expect(document?.webUrl()).toEndWith('/app/canvas/doc-1');
  expect(document?.toMention().tag).toContain('"documentName":"Launch plan"');
  expect(document?.toMention().tag).toContain('"blockName":"canvas"');
  expect(await document?.name()).toBe('Launch plan');
  expect(await document?.fileType()).toBe('canvas');
  expect(await document?.updatedAt()).toBe('2026-01-02T00:00:00Z');
  expect(detailRequests).toEqual([]);
  expect((await document?.project())?.id).toBe('project-1');
  expect(detailRequests).toEqual(['doc-1']);
});

test('email.inbox() handles read preview fields without a thread request', async () => {
  const threadRequests: string[] = [];
  const preview: ApiThreadPreviewCursorInner = {
    id: 'thread-1',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-02T00:00:00Z',
    inboxVisible: true,
    isDraft: false,
    isImportant: false,
    isRead: false,
    linkId: 'link-1',
    name: 'Re: Launch',
    ownerId: 'macro|owner@example.com',
    sortTs: '2026-01-02T00:00:00Z',
  };
  const client = {
    email: {
      previewsInboxCursor: async () => ({
        data: { items: [preview], next_cursor: null },
      }),
      getThread: async (options: { path: { thread_id: string } }) => {
        threadRequests.push(options.path.thread_id);
        return {
          data: {
            thread: {
              messages: [{ subject: 'Launch' }],
            },
          },
        };
      },
    },
  } as unknown as MacroClient;

  const [thread] = await Array.fromAsync(new EmailNamespace(client).inbox());

  expect(await thread?.isRead()).toBe(false);
  expect(await thread?.inboxVisible()).toBe(true);
  expect((await thread?.link())?.id).toBe('link-1');
  expect(threadRequests).toEqual([]);
  // The preview's subject is the latest message's and its times are inbox
  // sort times; subject() and createdAt() mean the thread's, so they load.
  expect(await thread?.subject()).toBe('Launch');
  expect(threadRequests).toEqual(['thread-1']);
});
