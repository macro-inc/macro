import { type Accessor, createMemo, createRoot, getOwner } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { seedMockDisplayNames } from './displayName';
import { idToDisplayName } from './util';

const mocks = vi.hoisted(() => ({
  getUserNamesWithEmail: vi.fn(),
}));

vi.mock('@service-auth/client', () => ({
  authServiceClient: {
    getUserNamesWithEmail: mocks.getUserNamesWithEmail,
  },
}));

describe('display name cache', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mocks.getUserNamesWithEmail.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('deduplicates repeated lookups into one batched request', async () => {
    const id = 'macro|deduplicated@example.com';
    mocks.getUserNamesWithEmail.mockResolvedValue({
      isErr: () => false,
      value: {
        names: [
          {
            id,
            first_name: 'Dedupe',
            last_name: 'User',
          },
        ],
      },
    });

    for (let index = 0; index < 1_000; index++) {
      expect(idToDisplayName(id)).toBe('deduplicated');
    }

    await vi.advanceTimersByTimeAsync(10);

    expect(mocks.getUserNamesWithEmail).toHaveBeenCalledOnce();
    expect(mocks.getUserNamesWithEmail).toHaveBeenCalledWith({
      user_ids: [id],
    });
    expect(idToDisplayName(id)).toBe('Dedupe User');
  });

  it('does not create reactive computations for repeated cached lookups', () => {
    const id = 'macro|cached@example.com';
    seedMockDisplayNames([{ id, firstName: 'Cached', lastName: 'User' }]);

    createRoot((dispose) => {
      const owner = getOwner();
      for (let index = 0; index < 1_000; index++) {
        expect(idToDisplayName(id)).toBe('Cached User');
      }

      expect(owner?.owned).toBeNull();
      dispose();
    });
  });

  it('updates tracked display-name reads when a batch completes', async () => {
    const id = 'macro|reactive@example.com';
    mocks.getUserNamesWithEmail.mockResolvedValue({
      isErr: () => false,
      value: {
        names: [
          {
            id,
            first_name: 'Reactive',
            last_name: 'User',
          },
        ],
      },
    });

    let displayName!: Accessor<string>;
    let dispose = () => {};
    createRoot((rootDispose) => {
      dispose = rootDispose;
      displayName = createMemo(() => idToDisplayName(id));
    });

    expect(displayName()).toBe('reactive');
    await vi.advanceTimersByTimeAsync(10);
    expect(displayName()).toBe('Reactive User');

    dispose();
  });
});
