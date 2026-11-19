import { ok, type Result } from 'neverthrow';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const postProfilePictures = vi.hoisted(() => vi.fn());
const scope = vi.hoisted(() => ({ session: 0 }));
vi.mock('@queries/auth/account-scope', () => ({
  queryAccountSession: () => scope.session,
}));
vi.mock('@service-auth/client', () => ({
  authServiceClient: { postProfilePictures },
}));

import {
  getProfilePictureUrl,
  handleUserPictureChanged,
  profilePictureItem,
  refreshProfilePicture,
  useProfilePictureUrl,
} from './profilePicture';

const picturesFor = (url?: string) => (args: { user_id_list: string[] }) =>
  Promise.resolve(
    ok({ pictures: args.user_id_list.map((id) => ({ id, url })) })
  );

describe('profile picture refresh', () => {
  beforeEach(() => {
    postProfilePictures.mockReset();
  });

  it('does not fetch users that are not cached', async () => {
    await refreshProfilePicture('macro|nobody@example.com');
    expect(postProfilePictures).not.toHaveBeenCalled();
  });

  it('refetches a cached user and updates the url', async () => {
    const id = 'macro|cached@example.com';
    postProfilePictures.mockImplementation(picturesFor('https://x/file/1'));
    expect(await getProfilePictureUrl(id)).toBe('https://x/file/1');

    postProfilePictures.mockImplementation(picturesFor('https://x/file/2'));
    await refreshProfilePicture(id);
    expect(postProfilePictures).toHaveBeenLastCalledWith({
      user_id_list: [id],
    });
    expect(await getProfilePictureUrl(id)).toBe('https://x/file/2');
  });

  it('handles a removed picture', async () => {
    const id = 'macro|removed@example.com';
    postProfilePictures.mockImplementation(picturesFor('https://x/file/1'));
    await getProfilePictureUrl(id);
    postProfilePictures.mockImplementation(picturesFor(undefined));
    await refreshProfilePicture(id);
    expect(await getProfilePictureUrl(id)).toBeUndefined();
  });

  it('ignores malformed payloads', () => {
    for (const bad of [undefined, null, {}, { user_id: 1 }, { user_id: '' }]) {
      handleUserPictureChanged(bad);
    }
    expect(postProfilePictures).not.toHaveBeenCalled();
  });

  it('refreshes the cached user from a valid payload', async () => {
    const id = 'macro|handler@example.com';
    postProfilePictures.mockImplementation(picturesFor('https://x/file/1'));
    await getProfilePictureUrl(id);
    postProfilePictures.mockClear();
    handleUserPictureChanged({ user_id: id });
    await vi.waitFor(() =>
      expect(postProfilePictures).toHaveBeenCalledTimes(1)
    );
  });
});

describe('agent faces in the picture cache', () => {
  beforeEach(() => {
    postProfilePictures.mockReset();
  });

  const face = { v: 1, seed: 'k3x9q2', pins: { hair: 2 } };

  it('clears both face and URL when refresh omits the removed picture', async () => {
    const id = 'macro|removed-face@example.com';
    postProfilePictures.mockResolvedValue(
      ok({
        pictures: [
          { id, url: 'https://example.com/face.png', avatar_face: face },
        ],
      })
    );
    await getProfilePictureUrl(id);
    postProfilePictures.mockResolvedValue(ok({ pictures: [] }));
    await refreshProfilePicture(id);
    expect(profilePictureItem(id)?.face).toBeUndefined();
    expect(profilePictureItem(id)?.url).toBeUndefined();
  });

  it('clears face and URL when a batch refetch omits the removed picture', async () => {
    const id = 'macro|batch-removed-face@example.com';
    postProfilePictures.mockResolvedValue(
      ok({
        pictures: [
          { id, url: 'https://example.com/face.png', avatar_face: face },
        ],
      })
    );
    await getProfilePictureUrl(id);
    const [, picture] = useProfilePictureUrl(id);
    postProfilePictures.mockResolvedValue(ok({ pictures: [] }));
    picture.refetch();
    expect(await getProfilePictureUrl(id)).toBeUndefined();
    expect(profilePictureItem(id)?.face).toBeUndefined();
  });

  it('discards a late batch after the login session changes and permits a new read', async () => {
    const id = 'macro|retired-face@example.com';
    const started = Promise.withResolvers<void>();
    const response =
      Promise.withResolvers<
        Result<{ pictures: { id: string; url: string }[] }, unknown>
      >();
    postProfilePictures.mockImplementationOnce(() => {
      started.resolve();
      return response.promise;
    });
    const oldRead = getProfilePictureUrl(id);
    await started.promise;
    scope.session += 1;
    response.resolve(
      ok({ pictures: [{ id, url: 'https://example.com/retired.png' }] })
    );
    expect(await oldRead).toBeUndefined();
    expect(profilePictureItem(id)?.url).toBeUndefined();
    postProfilePictures.mockResolvedValue(
      ok({ pictures: [{ id, url: 'https://example.com/current.png' }] })
    );
    expect(await getProfilePictureUrl(id)).toBe(
      'https://example.com/current.png'
    );
  });

  it('does not retire a newer request when the old session batch finishes', async () => {
    const id = 'macro|newer-picture-read@example.com';
    const oldStarted = Promise.withResolvers<void>();
    const newStarted = Promise.withResolvers<void>();
    const oldResponse =
      Promise.withResolvers<
        Result<{ pictures: { id: string; url: string }[] }, unknown>
      >();
    const newResponse =
      Promise.withResolvers<
        Result<{ pictures: { id: string; url: string }[] }, unknown>
      >();
    postProfilePictures
      .mockImplementationOnce(() => {
        oldStarted.resolve();
        return oldResponse.promise;
      })
      .mockImplementationOnce(() => {
        newStarted.resolve();
        return newResponse.promise;
      });
    const oldRead = getProfilePictureUrl(id);
    await oldStarted.promise;
    scope.session += 1;
    const [, picture] = useProfilePictureUrl(id);
    picture.refetch();
    const newRead = getProfilePictureUrl(id);
    await newStarted.promise;
    const newGeneration = profilePictureItem(id)?._createdAt;
    oldResponse.resolve(
      ok({ pictures: [{ id, url: 'https://example.com/retired.png' }] })
    );
    await oldResponse.promise;
    expect(profilePictureItem(id)?.loading).toBe(true);
    expect(profilePictureItem(id)?._createdAt).toBe(newGeneration);
    newResponse.resolve(
      ok({ pictures: [{ id, url: 'https://example.com/current.png' }] })
    );
    expect(await newRead).toBe('https://example.com/current.png');
    expect(await oldRead).toBe('https://example.com/current.png');
  });

  it('marks a user with no picture as loaded', async () => {
    const id = 'macro|no-picture@example.com';
    postProfilePictures.mockResolvedValue(ok({ pictures: [] }));
    expect(await getProfilePictureUrl(id)).toBeUndefined();
    expect(profilePictureItem(id)?.loading).toBe(false);
  });

  it('keeps a face that has no PNG yet', async () => {
    const id = 'macro|face-only@example.com';
    postProfilePictures.mockResolvedValue(
      ok({ pictures: [{ id, url: null, avatar_face: face }] })
    );
    expect(await getProfilePictureUrl(id)).toBeUndefined();
    expect(profilePictureItem(id)?.face).toEqual(face);
  });

  it('drops a face it cannot draw and keeps the picture', async () => {
    const id = 'macro|future-face@example.com';
    postProfilePictures.mockResolvedValue(
      ok({
        pictures: [
          { id, url: 'https://x/file/1', avatar_face: { ...face, v: 2 } },
        ],
      })
    );
    expect(await getProfilePictureUrl(id)).toBe('https://x/file/1');
    expect(profilePictureItem(id)?.face).toBeUndefined();
  });

  it('picks up a face saved after the picture was cached', async () => {
    const id = 'macro|new-face@example.com';
    postProfilePictures.mockImplementation(picturesFor('https://x/file/1'));
    await getProfilePictureUrl(id);

    postProfilePictures.mockResolvedValue(
      ok({ pictures: [{ id, url: 'https://x/face.png', avatar_face: face }] })
    );
    await refreshProfilePicture(id);
    expect(profilePictureItem(id)?.face).toEqual(face);
  });
});

describe('reads that a newer read superseded', () => {
  beforeEach(() => {
    postProfilePictures.mockReset();
  });

  it('keeps a saved picture from an older refresh that finishes after it', async () => {
    const id = 'macro|superseded@example.com';
    postProfilePictures.mockImplementation(picturesFor('https://x/file/old'));
    await getProfilePictureUrl(id);

    // A refresh that started before the save answers with the old picture
    // only after the save's own refresh has stored the new one.
    const older = Promise.withResolvers<Result<unknown, unknown>>();
    postProfilePictures.mockReturnValueOnce(older.promise);
    const stale = refreshProfilePicture(id);
    postProfilePictures.mockImplementationOnce(
      picturesFor('https://x/file/new')
    );
    await refreshProfilePicture(id);
    older.resolve(ok({ pictures: [{ id, url: 'https://x/file/old' }] }));
    await stale;

    expect(profilePictureItem(id)?.url).toBe('https://x/file/new');
  });

  it('keeps a saved picture from an older batch that found none', async () => {
    const id = 'macro|batch-superseded@example.com';
    const batch = Promise.withResolvers<Result<unknown, unknown>>();
    postProfilePictures.mockReturnValueOnce(batch.promise);
    const reading = getProfilePictureUrl(id);
    await vi.waitFor(() =>
      expect(postProfilePictures).toHaveBeenCalledTimes(1)
    );

    postProfilePictures.mockImplementationOnce(
      picturesFor('https://x/file/new')
    );
    await refreshProfilePicture(id);
    batch.resolve(ok({ pictures: [] }));

    expect(await reading).toBe('https://x/file/new');
    expect(profilePictureItem(id)?.url).toBe('https://x/file/new');
  });
});
