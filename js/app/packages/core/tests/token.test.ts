import { createRoot } from 'solid-js';
import { createStore } from 'solid-js/store';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@core/block', () => ({
  useBlockId: vi.fn(),
}));

vi.mock('@service-storage/client', () => ({
  storageServiceClient: {
    permissionsTokens: {
      createPermissionToken: vi.fn(),
    },
  },
}));

vi.mock('@solid-primitives/rootless', () => ({
  createCallback: vi.fn((fn) => fn),
}));

import { storageServiceClient } from '@service-storage/client';
import { getPermissionToken } from '../signal/token';

describe('getPermissionToken', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('should fetch and return a new token when no token exists', async () => {
    const mockToken = 'new-token';
    vi.mocked(
      storageServiceClient.permissionsTokens.createPermissionToken
    ).mockResolvedValue([null, { token: mockToken }]);

    const token = await createRoot(async () => {
      return await getPermissionToken('document', 'block-123');
    });

    expect(
      storageServiceClient.permissionsTokens.createPermissionToken
    ).toHaveBeenCalledWith({
      document_id: 'block-123',
    });
    expect(token).toBe(mockToken);
  });

  it('should return cached token when token exists and is not expired', async () => {
    const futureExp = Math.floor(Date.now() / 1000) + 3600;
    const validToken = `header.${btoa(JSON.stringify({ exp: futureExp }))}.signature`;

    const [store, setStore] = createStore<Record<string, string>>({});
    setStore('document@block-123', validToken);

    const token = await createRoot(async () => {
      return await getPermissionToken('document', 'block-123', [
        store,
        setStore,
      ]);
    });

    expect(
      storageServiceClient.permissionsTokens.createPermissionToken
    ).not.toHaveBeenCalled();
    expect(token).toBe(validToken);
  });

  it('should fetch new token when cached token is expired', async () => {
    const pastExp = Math.floor(Date.now() / 1000) - 3600;
    const expiredToken = `header.${btoa(JSON.stringify({ exp: pastExp }))}.signature`;
    const newToken = 'fresh-token';

    const [store, setStore] = createStore<Record<string, string>>({});
    setStore('document@block-123', expiredToken);

    vi.mocked(
      storageServiceClient.permissionsTokens.createPermissionToken
    ).mockResolvedValue([null, { token: newToken }]);

    const token = await createRoot(async () => {
      return await getPermissionToken('document', 'block-123', [
        store,
        setStore,
      ]);
    });

    expect(
      storageServiceClient.permissionsTokens.createPermissionToken
    ).toHaveBeenCalledWith({
      document_id: 'block-123',
    });
    expect(token).toBe(newToken);
  });

  it('should return undefined when token fetch fails', async () => {
    vi.mocked(
      storageServiceClient.permissionsTokens.createPermissionToken
    ).mockResolvedValue([
      [{ code: 'NETWORK_ERROR', message: 'Failed to create token' }],
      null,
    ]);

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const token = await createRoot(async () => {
      return await getPermissionToken('document', 'block-123');
    });

    expect(token).toBeUndefined();
    expect(consoleSpy).toHaveBeenCalledWith(
      'Failed to create permission token:',
      [[{ code: 'NETWORK_ERROR', message: 'Failed to create token' }], null]
    );
    expect(consoleSpy).toHaveBeenCalledWith('Failed to fetch permission token');
  });
});
