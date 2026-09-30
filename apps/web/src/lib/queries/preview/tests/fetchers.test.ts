import { err, ok } from 'neverthrow';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const getBatchInitiativePreviews = vi.hoisted(() => vi.fn());

// Only the storage transport matters; keep the other fetchers' clients inert.
vi.mock('@service-storage/client', () => ({
  storageServiceClient: { getBatchInitiativePreviews },
}));
vi.mock('@service-cognition/client', () => ({ cognitionApiServiceClient: {} }));
vi.mock('@service-email/client', () => ({ emailClient: {} }));
vi.mock('@service-storage/messages', () => ({ entityMessagesClient: {} }));
vi.mock('@core/constant/allBlocks', () => ({ itemToSafeName: vi.fn() }));
vi.mock('@entity/types/entity', () => ({ toSubType: vi.fn() }));
vi.mock('../agent-session/mention-fetchers', () => ({
  fetchAgentSessionMentionPreviews: vi.fn(),
}));
vi.mock('../client', () => ({ queryClient: {} }));
vi.mock('../email/keys', () => ({ emailKeys: {} }));
vi.mock('../email/thread', () => ({ threadQueryOptions: vi.fn() }));
vi.mock('../email/thread-subject', () => ({
  representativeThreadMessage: vi.fn(),
}));
vi.mock('../messages/message-sender', () => ({
  normalizeMessageSender: vi.fn(),
}));

import { fetchRestPreviewBatch } from '../fetchers';

describe('task project REST previews', () => {
  beforeEach(() => getBatchInitiativePreviews.mockReset());

  it('maps each project preview like a channel preview', async () => {
    getBatchInitiativePreviews.mockResolvedValue(
      ok({
        previews: [
          { type: 'access', id: 'p-1', name: 'Launch', ownerId: 'macro|o' },
          { type: 'no_access', id: 'p-2' },
          { type: 'does_not_exist', id: 'p-3' },
        ],
      })
    );

    const previews = await fetchRestPreviewBatch([
      { id: 'p-1', type: 'initiative' },
      { id: 'p-2', type: 'initiative' },
      { id: 'p-3', type: 'initiative' },
    ]);

    expect(getBatchInitiativePreviews).toHaveBeenCalledWith({
      initiativeIds: ['p-1', 'p-2', 'p-3'],
    });
    expect([...previews.values()]).toEqual([
      {
        id: 'p-1',
        type: 'initiative',
        access: 'access',
        loading: false,
        rawName: 'Launch',
        name: 'Launch',
        owner: 'macro|o',
      },
      { id: 'p-2', type: 'initiative', access: 'no_access', loading: false },
      {
        id: 'p-3',
        type: 'initiative',
        access: 'does_not_exist',
        loading: false,
      },
    ]);
  });

  it('returns nothing for a failed request, as channels do', async () => {
    getBatchInitiativePreviews.mockResolvedValue(err(new Error('offline')));
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const previews = await fetchRestPreviewBatch([
      { id: 'p-1', type: 'initiative' },
    ]);

    expect(previews.size).toBe(0);
  });
});
