import { err, ok } from 'neverthrow';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const postProfilePictures = vi.hoisted(() => vi.fn());
vi.mock('@service-auth/client', () => ({
  authServiceClient: { postProfilePictures },
}));

import {
  getProfilePictureUrl,
  handleUserPictureChanged,
  refreshCachedProfilePictures,
  refreshCachedProfilePicturesOnReconnect,
  refreshProfilePicture,
} from './profilePicture';

const picturesFor = (url?: string) => (args: { user_id_list: string[] }) =>
  Promise.resolve(
    ok({ pictures: args.user_id_list.map((id) => ({ id, url })) })
  );

/** Like the real server: users without a picture are left out. */
const noPictures = () => Promise.resolve(ok({ pictures: [] }));

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

  it('refreshes every cached user after a reconnect, in batches', async () => {
    const ids = Array.from(
      { length: 120 },
      (_, i) => `macro|resync${i}@example.com`
    );
    postProfilePictures.mockImplementation(picturesFor('https://x/file/old'));
    await Promise.all(ids.map((id) => getProfilePictureUrl(id)));

    postProfilePictures.mockClear();
    postProfilePictures.mockImplementation(picturesFor('https://x/file/new'));
    await refreshCachedProfilePictures();

    const requested = postProfilePictures.mock.calls.flatMap(
      ([args]) => args.user_id_list as string[]
    );
    expect(requested).toEqual(expect.arrayContaining(ids));
    for (const [args] of postProfilePictures.mock.calls) {
      expect(args.user_id_list.length).toBeLessThanOrEqual(100);
    }
    for (const id of ids) {
      expect(await getProfilePictureUrl(id)).toBe('https://x/file/new');
    }
  });

  it('keeps cached urls when a reconnect refresh fails', async () => {
    const id = 'macro|resync-fail@example.com';
    postProfilePictures.mockImplementation(picturesFor('https://x/file/1'));
    await getProfilePictureUrl(id);
    postProfilePictures.mockImplementation(() =>
      Promise.resolve(err(new Error('down')))
    );
    await refreshCachedProfilePictures();
    expect(await getProfilePictureUrl(id)).toBe('https://x/file/1');
  });

  it('loads users the server returns no picture for', async () => {
    const id = 'macro|no-picture@example.com';
    postProfilePictures.mockImplementation(noPictures);
    expect(await getProfilePictureUrl(id)).toBeUndefined();
  });

  it('picks up a picture set while a reconnect missed the frame', async () => {
    const id = 'macro|new-agent@example.com';
    postProfilePictures.mockImplementation(noPictures);
    await getProfilePictureUrl(id);

    postProfilePictures.mockImplementation(picturesFor('https://x/file/set'));
    await refreshCachedProfilePictures();
    expect(await getProfilePictureUrl(id)).toBe('https://x/file/set');
  });

  it('does not overwrite an entry written after the batch was sent', async () => {
    const id = 'macro|race@example.com';
    postProfilePictures.mockImplementation(picturesFor('https://x/file/1'));
    await getProfilePictureUrl(id);

    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let sent!: () => void;
    const batchSent = new Promise<void>((resolve) => (sent = resolve));
    // The sweep's batch for this user answers only after the live refetch.
    postProfilePictures.mockImplementation(
      async (args: { user_id_list: string[] }) => {
        if (args.user_id_list.length === 1) {
          return picturesFor('https://x/file/new')(args);
        }
        if (args.user_id_list.includes(id)) {
          sent();
          await gate;
        }
        return picturesFor('https://x/file/stale')(args);
      }
    );
    const sweep = refreshCachedProfilePictures();

    await batchSent;
    await new Promise((resolve) => setTimeout(resolve, 5));
    await refreshProfilePicture(id);
    release();
    await sweep;
    expect(await getProfilePictureUrl(id)).toBe('https://x/file/new');
  });

  it('coalesces overlapping reconnects into one extra pass', async () => {
    const id = 'macro|coalesce@example.com';
    postProfilePictures.mockImplementation(picturesFor('https://x/file/1'));
    await getProfilePictureUrl(id);
    postProfilePictures.mockClear();

    refreshCachedProfilePicturesOnReconnect();
    refreshCachedProfilePicturesOnReconnect();
    refreshCachedProfilePicturesOnReconnect();
    await vi.waitFor(() => {
      const sweeps = postProfilePictures.mock.calls.filter(([args]) =>
        args.user_id_list.includes(id)
      );
      expect(sweeps).toHaveLength(2);
    });
  });

  it('keeps a live update when an older sweep batch answers in between', async () => {
    const id = 'macro|race-mirror@example.com';
    postProfilePictures.mockImplementation(picturesFor('https://x/file/1'));
    await getProfilePictureUrl(id);

    let releaseSweep!: () => void;
    const sweepGate = new Promise<void>((resolve) => (releaseSweep = resolve));
    let sweepSent!: () => void;
    const sweepWasSent = new Promise<void>((resolve) => (sweepSent = resolve));
    let releaseLive!: () => void;
    const liveGate = new Promise<void>((resolve) => (releaseLive = resolve));
    let liveSent!: () => void;
    const liveWasSent = new Promise<void>((resolve) => (liveSent = resolve));
    postProfilePictures.mockImplementation(
      async (args: { user_id_list: string[] }) => {
        if (args.user_id_list.length === 1 && args.user_id_list[0] === id) {
          liveSent();
          await liveGate;
          return picturesFor('https://x/file/new')(args);
        }
        if (args.user_id_list.includes(id)) {
          sweepSent();
          await sweepGate;
          return picturesFor('https://x/file/stale')(args);
        }
        return picturesFor('https://x/file/stale')(args);
      }
    );

    // Sweep sent first, then the live refetch; the sweep answers between the
    // live request and its response.
    const sweep = refreshCachedProfilePictures();
    await sweepWasSent;
    await new Promise((resolve) => setTimeout(resolve, 5));
    const live = refreshProfilePicture(id);
    await liveWasSent;
    await new Promise((resolve) => setTimeout(resolve, 5));
    releaseSweep();
    await sweep;
    releaseLive();
    await live;
    expect(await getProfilePictureUrl(id)).toBe('https://x/file/new');
  });

  it('keeps a live update when an older first-load fetch answers in between', async () => {
    const id = 'macro|race-queue@example.com';
    let releaseQueue!: () => void;
    const queueGate = new Promise<void>((resolve) => (releaseQueue = resolve));
    let queueSent!: () => void;
    const queueWasSent = new Promise<void>((resolve) => (queueSent = resolve));
    let releaseLive!: () => void;
    const liveGate = new Promise<void>((resolve) => (releaseLive = resolve));
    let liveSent!: () => void;
    const liveWasSent = new Promise<void>((resolve) => (liveSent = resolve));
    let calls = 0;
    postProfilePictures.mockImplementation(
      async (args: { user_id_list: string[] }) => {
        calls += 1;
        if (calls === 1) {
          queueSent();
          await queueGate;
          return picturesFor('https://x/file/stale')(args);
        }
        liveSent();
        await liveGate;
        return picturesFor('https://x/file/new')(args);
      }
    );

    // First mount queues a fetch; the live refetch is sent while it's in
    // flight, and the first-load response answers before the live one.
    const loaded = getProfilePictureUrl(id);
    await queueWasSent;
    await new Promise((resolve) => setTimeout(resolve, 5));
    const live = refreshProfilePicture(id);
    await liveWasSent;
    await new Promise((resolve) => setTimeout(resolve, 5));
    releaseQueue();
    await loaded;
    releaseLive();
    await live;
    expect(await getProfilePictureUrl(id)).toBe('https://x/file/new');
  });

  it('retries a first load that failed instead of waiting forever', async () => {
    const id = 'macro|first-load-fails@example.com';
    postProfilePictures.mockImplementation(() =>
      Promise.resolve(err(new Error('down')))
    );
    expect(await getProfilePictureUrl(id)).toBeUndefined();
  });
});
