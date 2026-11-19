import { ok } from 'neverthrow';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const postProfilePictures = vi.hoisted(() => vi.fn());
vi.mock('@service-auth/client', () => ({
  authServiceClient: { postProfilePictures },
}));

import {
  getProfilePictureUrl,
  handleUserPictureChanged,
  profilePictureItem,
  refreshProfilePicture,
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
