import { expect, it, vi } from 'vitest';

const fetchGraphqlSoupEntities = vi.hoisted(() => vi.fn());
vi.mock('../../soup/graphql/fetch-page', () => ({ fetchGraphqlSoupEntities }));
vi.mock('@service-storage/client', () => ({ storageServiceClient: {} }));
vi.mock('@core/constant/allBlocks', () => ({ itemToSafeName: () => '' }));
vi.mock('@service-cognition/client', () => ({ cognitionApiServiceClient: {} }));
vi.mock('@service-email/client', () => ({ emailClient: {} }));
vi.mock('@service-storage/messages', () => ({ entityMessagesClient: {} }));
vi.mock('../../client', () => ({ queryClient: {} }));
vi.mock('../../agent-session/mention-fetchers', () => ({
  fetchAgentSessionMentionPreviews: vi.fn(),
}));

import { fetchRestPreviewBatch } from '../fetchers';

it('previews task projects through Soup when the live preview has no record', async () => {
  fetchGraphqlSoupEntities.mockResolvedValueOnce({
    items: [
      {
        tag: 'initiative',
        data: {
          id: 'initiative-1',
          name: 'Roadmap',
          ownerId: 'owner',
          createdAt: '2026-10-01T00:00:00Z',
          updatedAt: '2026-10-02T00:00:00Z',
          properties: [],
        },
      },
    ],
  });
  const batch = await fetchRestPreviewBatch([
    { type: 'initiative', id: 'initiative-1' },
    { type: 'initiative', id: 'hidden' },
  ]);
  expect(fetchGraphqlSoupEntities).toHaveBeenCalledWith(
    [
      { entityType: 'INITIATIVE', entityId: 'initiative-1' },
      { entityType: 'INITIATIVE', entityId: 'hidden' },
    ],
    { requestPolicy: 'network-only' }
  );
  expect(batch.previews.get('initiative-1')).toMatchObject({
    type: 'initiative',
    access: 'access',
    name: 'Roadmap',
  });
  // The loader reports ids Soup does not return as no access.
  expect(batch.previews.has('hidden')).toBe(false);
});
