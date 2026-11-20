import { err, errAsync, ok } from 'neverthrow';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ShareKind } from '../core/share-item';
import { changeChannelAccess } from './channel-access';

const clients = vi.hoisted(() => ({
  updateAgentSessionSharePermissions: vi.fn(),
  updateDatabaseSharePermissions: vi.fn(),
  updateInitiativeSharePermissions: vi.fn(),
  updateFormSharePermissions: vi.fn(),
  updatePipelineSharePermissions: vi.fn(),
  updateEntitySharePolicy: vi.fn(),
}));

vi.mock('@queries/storage/entity-mutations', () => ({
  updateEntitySharePolicy: clients.updateEntitySharePolicy,
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
vi.mock('@queries/storage/forms', () => ({
  updateFormSharePermissions: clients.updateFormSharePermissions,
}));
vi.mock('@app/features/crm/sharing-adapter', () => ({
  updatePipelineSharePermissions: clients.updatePipelineSharePermissions,
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
  it.each<ShareKind>(['document', 'chat', 'project', 'email'])(
    'sets and removes %s access through the GraphQL share policy',
    async (kind) => {
      const set = await changeChannelAccess(
        { kind, id: 'item-1' },
        { t: 'set', channelId: 'channel-1', level: 'edit' }
      );
      const removed = await changeChannelAccess(
        { kind, id: 'item-1' },
        { t: 'remove', channelId: 'channel-1' }
      );

      expect([set, removed]).toEqual([ok(undefined), ok(undefined)]);
      expect(callsByClient()).toEqual({
        updateEntitySharePolicy: [
          [kind, 'item-1', { channelSharePermissions: [replace] }],
          [kind, 'item-1', { channelSharePermissions: [remove] }],
        ],
      });
    }
  );

  it.each<{ kind: ShareKind; calls: Record<string, unknown[][]> }>([
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
    {
      kind: 'form',
      calls: {
        updateFormSharePermissions: [
          [{ id: 'item-1', channelSharePermissions: [replace] }],
        ],
      },
    },
    {
      kind: 'crm_pipeline',
      calls: {
        updatePipelineSharePermissions: [
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

  it('removes access without a level through its own client', async () => {
    await changeChannelAccess(
      { kind: 'agent_session', id: 'session-1' },
      { t: 'remove', channelId: 'channel-1' }
    );

    expect(callsByClient()).toEqual({
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

    expect(result).toEqual(err({ kind: 'unsupported' }));
    expect(callsByClient()).toEqual({});
  });

  it.each(['UNAUTHORIZED', 'FORBIDDEN'])(
    'reports %s as not allowed',
    async (code) => {
      clients.updateEntitySharePolicy.mockResolvedValue(
        err([{ code, message: code }])
      );

      const result = await changeChannelAccess(
        { kind: 'project', id: 'folder-1' },
        { t: 'set', channelId: 'channel-1', level: 'view' }
      );

      expect(result).toEqual(err({ kind: 'not-allowed' }));
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

    expect(result).toEqual(err({ kind: 'not-allowed' }));
  });

  it('reports any other error as failed and logs it once', async () => {
    const errors = [{ code: 'SERVER_ERROR', message: 'boom' }];
    clients.updateEntitySharePolicy.mockResolvedValue(err(errors));

    const result = await changeChannelAccess(
      { kind: 'chat', id: 'chat-1' },
      { t: 'set', channelId: 'channel-1', level: 'view' }
    );

    expect(result).toEqual(err({ kind: 'failed' }));
    expect(logged.mock.calls).toEqual([
      ['Failed to change channel access', errors],
    ]);
  });

  it('reports a thrown client as failed and logs it once', async () => {
    const thrown = new Error('network down');
    clients.updateEntitySharePolicy.mockRejectedValue(thrown);

    const result = await changeChannelAccess(
      { kind: 'email', id: 'thread-1' },
      { t: 'set', channelId: 'channel-1', level: 'view' }
    );

    expect(result).toEqual(err({ kind: 'failed' }));
    expect(logged.mock.calls).toEqual([
      ['Failed to change channel access', thrown],
    ]);
  });
});
