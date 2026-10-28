import { ok } from 'neverthrow';
import { expect, it, vi } from 'vitest';

const getSoupItems = vi.hoisted(() => vi.fn());
vi.mock('@service-storage/client', () => ({
  storageServiceClient: { getSoupItems },
}));
vi.mock('@core/constant/allBlocks', () => ({ itemToSafeName: () => '' }));
vi.mock('@service-cognition/client', () => ({ cognitionApiServiceClient: {} }));
vi.mock('@service-email/client', () => ({ emailClient: {} }));
vi.mock('@service-storage/messages', () => ({ entityMessagesClient: {} }));
vi.mock('../../email/thread', () => ({ threadQueryOptions: vi.fn() }));
vi.mock('../../client', () => ({ queryClient: {} }));
vi.mock('../../agent-session/mention-fetchers', () => ({
  fetchAgentSessionMentionPreviews: vi.fn(),
}));

import { fetchRestPreviewBatch } from '../fetchers';

it('previews task projects through Soup without a GraphQL record', async () => {
  getSoupItems.mockResolvedValueOnce(
    ok({
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
    })
  );
  const previews = await fetchRestPreviewBatch([
    { type: 'initiative', id: 'initiative-1' },
    { type: 'initiative', id: 'hidden' },
  ]);
  expect(getSoupItems).toHaveBeenCalledWith({
    params: {},
    body: expect.objectContaining({
      initiative_filters: { initiative_ids: ['initiative-1', 'hidden'] },
      limit: 2,
    }),
  });
  expect(previews.get('initiative-1')).toMatchObject({
    type: 'initiative',
    access: 'access',
    name: 'Roadmap',
  });
  // The loader reports ids Soup does not return as no access.
  expect(previews.has('hidden')).toBe(false);
});
