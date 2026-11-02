import { err, ok } from 'neverthrow';
import { beforeEach, expect, it, vi } from 'vitest';

const createToken = vi.hoisted(() => vi.fn());
vi.mock('@service-storage/client', () => ({
  storageServiceClient: { collabSurfaces: { createToken } },
}));

import { getCollabSurfaceToken, mintCollabSurfaceToken } from './token';

function jwt(userId: string | null) {
  const claims = {
    document_id: 'surface',
    exp: Math.floor(Date.now() / 1000) + 3600,
    ...(userId === null ? {} : { user_id: userId }),
  };
  return `header.${btoa(JSON.stringify(claims))}.signature`;
}

beforeEach(() => createToken.mockReset());

it('never serves one viewer a token cached for another', async () => {
  const editor = jwt('macro|editor@example.com');
  const visitor = jwt(null);
  createToken
    .mockResolvedValueOnce(ok({ token: editor }))
    .mockResolvedValueOnce(ok({ token: visitor }));

  expect(
    await getCollabSurfaceToken('signed-out', 'macro|editor@example.com')
  ).toBe(editor);
  expect(await getCollabSurfaceToken('signed-out', null)).toBe(visitor);
  expect(
    await getCollabSurfaceToken('signed-out', 'macro|editor@example.com')
  ).toBe(editor);
  expect(createToken).toHaveBeenCalledTimes(2);
});

it('does not cache a token minted for someone other than the caller', async () => {
  createToken.mockResolvedValue(ok({ token: jwt('macro|other@example.com') }));

  await getCollabSurfaceToken('switched', 'macro|editor@example.com');
  await getCollabSurfaceToken('switched', 'macro|editor@example.com');

  expect(createToken).toHaveBeenCalledTimes(2);
});

it('tells a surface nobody started apart from a refusal', async () => {
  createToken
    .mockResolvedValueOnce(err([{ code: 'NOT_FOUND', message: 'missing' }]))
    .mockResolvedValueOnce(err([{ code: 'FORBIDDEN', message: 'no access' }]));

  expect(await mintCollabSurfaceToken('never-started', null)).toEqual({
    error: 'absent',
  });
  expect(await mintCollabSurfaceToken('private', null)).toEqual({
    error: 'failed',
  });
});
