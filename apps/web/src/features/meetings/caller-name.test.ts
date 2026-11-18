import { beforeEach, expect, it, vi } from 'vitest';
import { callerDisplayName } from './caller-name';

const mocks = vi.hoisted(() => ({
  loaded: false,
  resolver: vi.fn(),
}));

vi.mock('@notifications/notification-resolvers', () => ({
  DefaultUserNameResolver: mocks.resolver,
}));
vi.mock('@core/user/util', () => ({
  idToDisplayName: (id: string) => {
    if (id === 'macro|ada@example.com')
      return mocks.loaded ? 'Ada Lovelace' : 'ada';
    return id === 'macro|qareen@example.com' ? 'qareen' : '';
  },
}));

beforeEach(() => {
  mocks.loaded = false;
  mocks.resolver.mockReset();
});

it('names the caller once their name has loaded', async () => {
  mocks.resolver.mockImplementation(async () => {
    mocks.loaded = true;
    return 'Ada Lovelace';
  });

  expect(await callerDisplayName('macro|ada@example.com')).toBe('Ada Lovelace');
});

it('uses the address local part, not the whole email, for a caller without a name', async () => {
  mocks.resolver.mockResolvedValue('qareen@example.com');

  expect(await callerDisplayName('macro|qareen@example.com')).toBe('qareen');
});
