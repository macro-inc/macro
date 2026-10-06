import { err, errAsync, ok } from 'neverthrow';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ShareKind } from '../core/share-item';
import { changeChannelAccess } from './channel-access';

const clients = vi.hoisted(() => ({
  editDocument: vi.fn(),
  updateChatPermissions: vi.fn(),
  editProject: vi.fn(),
  editThread: vi.fn(),
  updateAgentSessionSharePermissions: vi.fn(),
  updateDatabaseSharePermissions: vi.fn(),
  updateInitiativeSharePermissions: vi.fn(),
}));

vi.mock('@service-storage/client', () => ({
  storageServiceClient: {
    editDocument: clients.editDocument,
    editThread: clients.editThread,
    projects: { edit: clients.editProject },
  },
}));
vi.mock('@service-cognition/client', () => ({
  cognitionApiServiceClient: {
    updateChatPermissions: clients.updateChatPermissions,
  },
}));
vi.mock('@queries/agent-session/share-permissions', () => ({
  updateAgentSessionSharePermissions:
    clients.updateAgentSessionSharePermissions,
}));
vi.mock('@queries/storage/databases', () => ({
  updateDatabaseSharePermissions: clients.updateDatabaseSharePermissions,
}));
vi.mock('@queries/initiative/share-permissions', () => ({
  updateInitiativeSharePermissions: clients.updateInitiativeSharePermissions,
}));

const logged = vi.spyOn(console, 'error').mockImplementation(() => {});

function callsByClient() {
  return Object.fromEntries(
    Object.entries(clients)
      .filter(([, client]) => client.mock.calls.length > 0)
      .map(([name, client]) => [name, client.mock.calls])
  );
}

const replace = {
  operation: 'replace',
  accessLevel: 'edit',
  channelId: 'channel-1',
};
const remove = { operation: 'remove', channelId: 'channel-1' };

beforeEach(() => {
  for (const client of Object.values(clients)) client.mockResolvedValue(ok({}));
});
afterEach(() => vi.clearAllMocks());

describe('changeChannelAccess', () => {
  it.each<{ kind: ShareKind; calls: Record<string, unknown[][]> }>([
    {
      kind: 'document',
      calls: {
        editDocument: [
          [
            {
              documentId: 'item-1',
              sharePermission: { channelSharePermissions: [replace] },
            },
          ],
        ],
      },
    },
    {
      kind: 'chat',
      calls: {
        updateChatPermissions: [
          [
            {
              chat_id: 'item-1',
              sharePermission: { channelSharePermissions: [replace] },
            },
          ],
        ],
      },
    },
    {
      kind: 'project',
      calls: {
        editProject: [
          [
            {
              id: 'item-1',
              sharePermission: { channelSharePermissions: [replace] },
            },
          ],
        ],
      },
    },
    {
      kind: 'email',
      calls: {
        editThread: [
          [
            {
              threadId: 'item-1',
              sharePermission: { channelSharePermissions: [replace] },
            },
          ],
        ],
      },
    },
    {
      kind: 'agent_session',
      calls: {
        updateAgentSessionSharePermissions: [
          ['item-1', { channelSharePermissions: [replace] }],
        ],
      },
    },
    {
      kind: 'database',
      calls: {
        updateDatabaseSharePermissions: [
          [{ id: 'item-1', channelSharePermissions: [replace] }],
        ],
      },
    },
    {
      kind: 'initiative',
      calls: {
        updateInitiativeSharePermissions: [
          ['item-1', { channelSharePermissions: [replace] }],
        ],
      },
    },
  ])('sets $kind access through its own client', async ({ kind, calls }) => {
    const result = await changeChannelAccess(
      { kind, id: 'item-1' },
      { t: 'set', channelId: 'channel-1', level: 'edit' }
    );

    expect(result).toEqual(ok(undefined));
    expect(callsByClient()).toEqual(calls);
  });

  it('removes access without a level, wrapped or not', async () => {
    await changeChannelAccess(
      { kind: 'document', id: 'doc-1' },
      { t: 'remove', channelId: 'channel-1' }
    );
    await changeChannelAccess(
      { kind: 'agent_session', id: 'session-1' },
      { t: 'remove', channelId: 'channel-1' }
    );

    expect(callsByClient()).toEqual({
      editDocument: [
        [
          {
            documentId: 'doc-1',
            sharePermission: { channelSharePermissions: [remove] },
          },
        ],
      ],
      updateAgentSessionSharePermissions: [
        ['session-1', { channelSharePermissions: [remove] }],
      ],
    });
  });

  it('reports a call as unsupported without a request', async () => {
    const result = await changeChannelAccess(
      { kind: 'call', id: 'call-1' },
      { t: 'set', channelId: 'channel-1', level: 'view' }
    );

    expect(result).toEqual(err('unsupported'));
    expect(callsByClient()).toEqual({});
  });

  it.each(['UNAUTHORIZED', 'FORBIDDEN'])(
    'reports %s as not allowed',
    async (code) => {
      clients.editProject.mockResolvedValue(err([{ code, message: code }]));

      const result = await changeChannelAccess(
        { kind: 'project', id: 'folder-1' },
        { t: 'set', channelId: 'channel-1', level: 'view' }
      );

      expect(result).toEqual(err('not-allowed'));
    }
  );

  it('reads a refusal from the database client result', async () => {
    clients.updateDatabaseSharePermissions.mockReturnValue(
      errAsync([{ code: 'UNAUTHORIZED', message: 'unauthorized' }])
    );

    const result = await changeChannelAccess(
      { kind: 'database', id: 'db-1' },
      { t: 'set', channelId: 'channel-1', level: 'view' }
    );

    expect(result).toEqual(err('not-allowed'));
  });

  it('reports any other error as failed and logs it once', async () => {
    const errors = [{ code: 'SERVER_ERROR', message: 'boom' }];
    clients.updateChatPermissions.mockResolvedValue(err(errors));

    const result = await changeChannelAccess(
      { kind: 'chat', id: 'chat-1' },
      { t: 'set', channelId: 'channel-1', level: 'view' }
    );

    expect(result).toEqual(err('failed'));
    expect(logged.mock.calls).toEqual([
      ['Failed to change channel access', errors],
    ]);
  });

  it('reports a thrown client as failed and logs it once', async () => {
    const thrown = new Error('network down');
    clients.editThread.mockRejectedValue(thrown);

    const result = await changeChannelAccess(
      { kind: 'email', id: 'thread-1' },
      { t: 'set', channelId: 'channel-1', level: 'view' }
    );

    expect(result).toEqual(err('failed'));
    expect(logged.mock.calls).toEqual([
      ['Failed to change channel access', thrown],
    ]);
  });
});
