import type { BotFieldsFragment } from '@service-storage/graphql/generated/graphql';
import type { Client } from '@urql/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  host: undefined as
    | {
        disabled: false;
        readRecordsByKeys: ReturnType<typeof vi.fn>;
        writeQuery: ReturnType<typeof vi.fn>;
      }
    | undefined,
  client: {} as Client,
}));
const revalidateBotIdentities = vi.hoisted(() => vi.fn(async () => {}));

vi.mock('@service-storage/graphql-soup', () => ({
  getGraphqlCacheHost: () => state.host,
  getGraphqlSoupClient: () => state.client,
}));
vi.mock('./graphql-bots', () => ({ revalidateBotIdentities }));

import { applyOwnBotWrite } from './own-bot-writes';

const BOT = '5f0c8a4e-2d1b-4c3a-9e7f-6a5b4c3d2e1f';
const cached: BotFieldsFragment = {
  id: BOT,
  name: 'Release bot',
  handle: 'release-bot',
  avatarUrl: null,
  deletedAt: null,
  isSystem: false,
};

beforeEach(() => {
  revalidateBotIdentities.mockClear();
  state.host = {
    disabled: false,
    readRecordsByKeys: vi.fn(async () => ({
      revision: '1',
      records: [{ recordKey: `GraphqlBot:${BOT}`, record: cached }],
    })),
    writeQuery: vi.fn(async () => ({})),
  };
});

describe('applyOwnBotWrite', () => {
  it('writes a rename into the bot record every view reads', async () => {
    await applyOwnBotWrite({
      id: BOT,
      name: 'Shipper',
      handle: 'shipper',
      avatarUrl: 'https://static.example/shipper.png',
    });

    expect(state.host?.writeQuery).toHaveBeenCalledOnce();
    expect(state.host?.writeQuery.mock.calls[0]?.[0]).toMatchObject({
      operationName: 'BotCacheWrite',
      data: {
        botUpdates: [
          {
            __typename: 'GraphqlBot',
            id: BOT,
            name: 'Shipper',
            handle: 'shipper',
            avatarUrl: 'https://static.example/shipper.png',
            deletedAt: null,
            isSystem: false,
          },
        ],
      },
    });
    expect(revalidateBotIdentities).not.toHaveBeenCalled();
  });

  it('marks a deleted bot deleted and keeps its name', async () => {
    await applyOwnBotWrite({ id: BOT, deleted: true });

    const written =
      state.host?.writeQuery.mock.calls[0]?.[0].data.botUpdates[0];
    expect(written).toMatchObject({ name: 'Release bot' });
    expect(written.deletedAt).toEqual(expect.any(String));
  });

  it('reads the bot again without the normalized cache', async () => {
    state.host = undefined;

    await applyOwnBotWrite({ id: BOT, name: 'Shipper' });

    expect(revalidateBotIdentities).toHaveBeenCalledExactlyOnceWith(
      state.client,
      new Set([BOT])
    );
  });

  it('writes nothing for a bot no view has read', async () => {
    state.host?.readRecordsByKeys.mockResolvedValue({
      revision: '1',
      records: [],
    });

    await applyOwnBotWrite({ id: BOT, name: 'Shipper' });

    expect(state.host?.writeQuery).not.toHaveBeenCalled();
  });
});
