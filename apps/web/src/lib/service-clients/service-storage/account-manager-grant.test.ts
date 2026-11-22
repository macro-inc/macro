import { ok } from 'neverthrow';
import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ fetchWithToken: vi.fn() }));

vi.mock('@core/util/fetchWithToken', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  fetchWithToken: mocks.fetchWithToken,
}));

import { storageServiceClient } from './client';

beforeEach(() => {
  mocks.fetchWithToken.mockReset();
  mocks.fetchWithToken.mockResolvedValue(ok({}));
});

// Source requests a stored card's grant id as it is, so a null or omitted id
// reaches the server as the literal path segment it is converted to.
it.each([
  ['probe-grant', '/account-managers/probe-grant'],
  [null, '/account-managers/null'],
  [undefined, '/account-managers/undefined'],
])('requests grant %s at %s', async (id, path) => {
  await storageServiceClient.getAccountManagerGrant({ id });

  expect(mocks.fetchWithToken).toHaveBeenCalledWith(
    expect.stringMatching(new RegExp(`${path}$`)),
    expect.objectContaining({ method: 'GET' })
  );
});
