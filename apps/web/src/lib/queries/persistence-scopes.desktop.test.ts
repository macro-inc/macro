import type * as PlatformModule from '@core/util/platform';
import { describe, expect, it, vi } from 'vitest';
import { authKeys } from './auth/keys';
import { createQueryPersistenceScopes } from './persistence-scopes';

vi.mock('@core/util/platform', async (importOriginal) => ({
  ...(await importOriginal<typeof PlatformModule>()),
  isTauri: () => true,
  getNativeMobilePlatform: () => undefined,
}));
vi.mock('@core/mobile/isNativeMobilePlatform', () => ({
  isNativeMobilePlatform: () => false,
}));

describe('desktop app query persistence', () => {
  // An offline relaunch has no way to fetch identity; without a restored
  // copy every account-gated view waits on it forever.
  it('persists user info so an offline relaunch keeps its identity', () => {
    const scopes = createQueryPersistenceScopes('test');
    expect(
      scopes.some((scope) => scope.shouldPersist(authKeys.userInfo.queryKey))
    ).toBe(true);
  });
});
