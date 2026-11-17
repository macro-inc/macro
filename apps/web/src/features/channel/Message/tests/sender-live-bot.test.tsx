import type { MessageData } from '@core/messages/types';
import type { BotFieldsFragment } from '@service-storage/graphql/generated/graphql';
import { cleanup, render } from '@solidjs/testing-library';
import { createClient, type Operation } from '@urql/core';
import { afterEach, expect, it, vi } from 'vitest';
import { map, pipe } from 'wonka';

const RELEASE_BOT = '5f0c8a4e-2d1b-4c3a-9e7f-6a5b4c3d2e1f';
const requests: string[][] = [];
const rows = new Map<string, BotFieldsFragment>();
const client = createClient({
  url: '/graphql',
  exchanges: [
    () => (operations) =>
      pipe(
        operations,
        map((operation: Operation) => {
          const ids = (operation.variables as { ids: string[] }).ids;
          if (operation.kind === 'query') requests.push(ids);
          return {
            operation,
            data: {
              user: {
                id: 'viewer',
                bots: ids.flatMap((id) => rows.get(id) ?? []),
              },
            },
            stale: false,
            hasNext: false,
          };
        })
      ),
  ],
});

vi.mock('@service-storage/graphql-soup', () => ({
  getGraphqlSoupClient: () => client,
}));

import { createBotUpdatesHandler } from '@queries/bots/bot-updates';
import { SenderName } from '../SenderName';

afterEach(cleanup);

const bot = (name: string): BotFieldsFragment => ({
  id: RELEASE_BOT,
  name,
  handle: 'release-bot',
  avatarUrl: null,
  deletedAt: null,
  isSystem: false,
});

it('renames a bot on a message sent before the rename after a botUpdates push', async () => {
  rows.set(RELEASE_BOT, bot('Release bot'));
  const message = {
    id: 'message-1',
    content: 'shipped',
    sender_id: `bot|${RELEASE_BOT}`,
    sender: {
      type: 'bot',
      id: RELEASE_BOT,
      name: 'Release bot',
      avatar_url: null,
    },
  } as unknown as MessageData;
  const view = render(() => <SenderName message={message} />);
  expect(view.container.textContent).toBe('Release bot');
  await vi.waitFor(() => expect(requests).toEqual([[RELEASE_BOT]]));

  // A client without the normalized cache reads the pushed bot again.
  rows.set(RELEASE_BOT, bot('Shipper'));
  createBotUpdatesHandler(client).onResult({
    operation: {} as Operation,
    data: { botUpdates: [bot('Shipper')] },
    stale: false,
    hasNext: true,
  });

  await vi.waitFor(() => expect(view.container.textContent).toBe('Shipper'));
  expect(requests).toEqual([[RELEASE_BOT], [RELEASE_BOT]]);
});
