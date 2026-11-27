import { err, ok } from 'neverthrow';
import { createRoot } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const postProfilePictures = vi.hoisted(() => vi.fn());
vi.mock('@service-auth/client', () => ({
  authServiceClient: { postProfilePictures },
}));

type Module = typeof import('./profilePicture');
let pictures: Module;

type Args = { user_id_list: string[] };

const picturesFor = (url?: string) => (args: Args) =>
  Promise.resolve(
    ok({ pictures: args.user_id_list.map((id) => ({ id, url })) })
  );

/** Like the real server: users without a picture are left out. */
const noPictures = () => Promise.resolve(ok({ pictures: [] }));

const requestedIds = () =>
  postProfilePictures.mock.calls.map(([args]) => [
    ...(args as Args).user_id_list,
  ]);

/** Past the reconnect delay (half the jitter bound, see `Math.random` below). */
const AFTER_RECONNECT_MS = 1_100;

/** Mounts an avatar for `id` the way a component does; returns its url and unmount. */
function mount(id: string) {
  return createRoot((dispose) => {
    const [url] = pictures.useProfilePictureUrl(id);
    return { url, unmount: dispose };
  });
}

/** A request that answers only when released, and reports when it was sent. */
function gated() {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  let sent!: () => void;
  const wasSent = new Promise<void>((resolve) => (sent = resolve));
  return { gate, release, sent, wasSent };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

describe('profile pictures', () => {
  beforeEach(async () => {
    vi.resetModules();
    postProfilePictures.mockReset();
    pictures = await import('./profilePicture');
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('loads avatars mounted together in one request', async () => {
    postProfilePictures.mockImplementation(picturesFor('https://x/file/1'));
    const ids = ['macro|a@example.com', 'macro|b@example.com'];
    const avatars = ids.map(mount);
    mount(ids[0]);
    await vi.waitFor(() => expect(avatars[1].url()).toBe('https://x/file/1'));
    expect(requestedIds()).toEqual([ids]);
  });

  it('does not refresh users that are not cached', async () => {
    await pictures.refreshProfilePicture('macro|nobody@example.com');
    expect(postProfilePictures).not.toHaveBeenCalled();
  });

  it('refetches a cached user and updates the url', async () => {
    const id = 'macro|cached@example.com';
    postProfilePictures.mockImplementation(picturesFor('https://x/file/1'));
    expect(await pictures.getProfilePictureUrl(id)).toBe('https://x/file/1');

    postProfilePictures.mockImplementation(picturesFor('https://x/file/2'));
    await pictures.refreshProfilePicture(id);
    expect(postProfilePictures).toHaveBeenLastCalledWith({
      user_id_list: [id],
    });
    expect(await pictures.getProfilePictureUrl(id)).toBe('https://x/file/2');
  });

  it('handles a removed picture', async () => {
    const id = 'macro|removed@example.com';
    postProfilePictures.mockImplementation(picturesFor('https://x/file/1'));
    await pictures.getProfilePictureUrl(id);
    postProfilePictures.mockImplementation(picturesFor(undefined));
    await pictures.refreshProfilePicture(id);
    expect(await pictures.getProfilePictureUrl(id)).toBeUndefined();
  });

  it('ignores malformed payloads', () => {
    for (const bad of [undefined, null, {}, { user_id: 1 }, { user_id: '' }]) {
      pictures.handleUserPictureChanged(bad);
    }
    expect(postProfilePictures).not.toHaveBeenCalled();
  });

  it('refreshes the cached user from a valid payload', async () => {
    const id = 'macro|handler@example.com';
    postProfilePictures.mockImplementation(picturesFor('https://x/file/1'));
    await pictures.getProfilePictureUrl(id);
    postProfilePictures.mockClear();
    pictures.handleUserPictureChanged({ user_id: id });
    await vi.waitFor(() =>
      expect(postProfilePictures).toHaveBeenCalledTimes(1)
    );
  });

  it('loads users the server returns no picture for', async () => {
    const id = 'macro|no-picture@example.com';
    postProfilePictures.mockImplementation(noPictures);
    expect(await pictures.getProfilePictureUrl(id)).toBeUndefined();
  });

  it('retries a first load that failed instead of waiting forever', async () => {
    const id = 'macro|first-load-fails@example.com';
    postProfilePictures.mockImplementation(() =>
      Promise.resolve(err(new Error('down')))
    );
    expect(await pictures.getProfilePictureUrl(id)).toBeUndefined();

    postProfilePictures.mockImplementation(picturesFor('https://x/file/1'));
    expect(await pictures.getProfilePictureUrl(id)).toBe('https://x/file/1');
  });

  it('resolves a first load whose request throws', async () => {
    const id = 'macro|first-load-throws@example.com';
    postProfilePictures.mockImplementation(() =>
      Promise.reject(new Error('token changed'))
    );
    const avatar = mount(id);
    expect(await pictures.getProfilePictureUrl(id)).toBeUndefined();
    expect(avatar.url()).toBeUndefined();
  });

  describe('on reconnect', () => {
    beforeEach(() => {
      vi.spyOn(Math, 'random').mockReturnValue(0.5);
    });

    afterEach(() => {
      vi.mocked(Math.random).mockRestore();
    });

    it('fetches nothing for users no avatar shows', async () => {
      postProfilePictures.mockImplementation(picturesFor('https://x/file/1'));
      const ids = Array.from(
        { length: 150 },
        (_, i) => `macro|unmounted${i}@example.com`
      );
      await Promise.all(ids.map((id) => pictures.getProfilePictureUrl(id)));
      const avatar = mount('macro|gone@example.com');
      await vi.waitFor(() => expect(avatar.url()).toBe('https://x/file/1'));
      avatar.unmount();
      postProfilePictures.mockClear();

      vi.useFakeTimers();
      pictures.invalidateProfilePicturesOnReconnect();
      await vi.advanceTimersByTimeAsync(AFTER_RECONNECT_MS);
      expect(postProfilePictures).not.toHaveBeenCalled();
    });

    it('refetches mounted avatars in one batched request', async () => {
      postProfilePictures.mockImplementation(picturesFor('https://x/file/old'));
      const mounted = Array.from(
        { length: 5 },
        (_, i) => `macro|mounted${i}@example.com`
      );
      const avatars = mounted.map(mount);
      mount(mounted[0]);
      await pictures.getProfilePictureUrl('macro|unmounted@example.com');
      await vi.waitFor(() =>
        expect(avatars.map((a) => a.url())).toEqual(
          mounted.map(() => 'https://x/file/old')
        )
      );
      postProfilePictures.mockClear();

      // The picture changed while the socket was down; its frame is lost.
      postProfilePictures.mockImplementation(picturesFor('https://x/file/new'));
      vi.useFakeTimers();
      pictures.invalidateProfilePicturesOnReconnect();
      expect(postProfilePictures).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(AFTER_RECONNECT_MS);

      expect(requestedIds()).toEqual([mounted]);
      expect(avatars.map((a) => a.url())).toEqual(
        mounted.map(() => 'https://x/file/new')
      );
    });

    it('refetches a stale picture when it next mounts, showing the old one meanwhile', async () => {
      const id = 'macro|later@example.com';
      postProfilePictures.mockImplementation(picturesFor('https://x/file/old'));
      await pictures.getProfilePictureUrl(id);

      pictures.invalidateProfilePicturesOnReconnect();
      const fetch = gated();
      postProfilePictures.mockImplementation(async (args: Args) => {
        fetch.sent();
        await fetch.gate;
        return picturesFor('https://x/file/new')(args);
      });
      const avatar = mount(id);
      expect(avatar.url()).toBe('https://x/file/old');
      await fetch.wasSent;
      // A second avatar mounting meanwhile shares the request.
      mount(id);
      fetch.release();
      await vi.waitFor(() => expect(avatar.url()).toBe('https://x/file/new'));
      expect(postProfilePictures).toHaveBeenCalledTimes(2);
    });

    it('returns the fresh picture when a stale one is read', async () => {
      const id = 'macro|read@example.com';
      postProfilePictures.mockImplementation(picturesFor('https://x/file/old'));
      await pictures.getProfilePictureUrl(id);
      pictures.invalidateProfilePicturesOnReconnect();
      postProfilePictures.mockImplementation(picturesFor('https://x/file/new'));
      expect(await pictures.getProfilePictureUrl(id)).toBe(
        'https://x/file/new'
      );
    });

    it('picks up a picture set for a user who had none', async () => {
      const id = 'macro|new-agent@example.com';
      postProfilePictures.mockImplementation(noPictures);
      const avatar = mount(id);
      await vi.waitFor(() => expect(postProfilePictures).toHaveBeenCalled());
      expect(avatar.url()).toBeUndefined();

      postProfilePictures.mockImplementation(picturesFor('https://x/file/set'));
      vi.useFakeTimers();
      pictures.invalidateProfilePicturesOnReconnect();
      await vi.advanceTimersByTimeAsync(AFTER_RECONNECT_MS);
      expect(avatar.url()).toBe('https://x/file/set');
    });

    it('coalesces overlapping reconnects into one request', async () => {
      const id = 'macro|coalesce@example.com';
      postProfilePictures.mockImplementation(picturesFor('https://x/file/1'));
      const avatar = mount(id);
      await vi.waitFor(() => expect(avatar.url()).toBe('https://x/file/1'));
      postProfilePictures.mockClear();

      vi.useFakeTimers();
      pictures.invalidateProfilePicturesOnReconnect();
      pictures.invalidateProfilePicturesOnReconnect();
      await vi.advanceTimersByTimeAsync(100);
      pictures.invalidateProfilePicturesOnReconnect();
      await vi.advanceTimersByTimeAsync(AFTER_RECONNECT_MS * 2);
      expect(requestedIds()).toEqual([[id]]);
    });

    it('keeps cached urls when the refetch fails, retries once, then waits for the next mount', async () => {
      const id = 'macro|resync-fail@example.com';
      postProfilePictures.mockImplementation(picturesFor('https://x/file/1'));
      const avatar = mount(id);
      await vi.waitFor(() => expect(avatar.url()).toBe('https://x/file/1'));

      postProfilePictures.mockImplementation(() =>
        Promise.resolve(err(new Error('down')))
      );
      vi.useFakeTimers();
      pictures.invalidateProfilePicturesOnReconnect();
      await vi.advanceTimersByTimeAsync(AFTER_RECONNECT_MS);
      expect(postProfilePictures).toHaveBeenCalledTimes(2);
      expect(avatar.url()).toBe('https://x/file/1');
      await vi.advanceTimersByTimeAsync(AFTER_RECONNECT_MS * 3);
      expect(postProfilePictures).toHaveBeenCalledTimes(3);
      expect(avatar.url()).toBe('https://x/file/1');
      vi.useRealTimers();

      postProfilePictures.mockImplementation(picturesFor('https://x/file/2'));
      mount(id);
      await vi.waitFor(() => expect(avatar.url()).toBe('https://x/file/2'));
    });

    it('refetches again when the response was requested before the reconnect', async () => {
      const id = 'macro|in-flight@example.com';
      postProfilePictures.mockImplementation(picturesFor('https://x/file/old'));
      const avatar = mount(id);
      await vi.waitFor(() => expect(avatar.url()).toBe('https://x/file/old'));

      // A live update's request is in flight when the socket drops; the
      // picture changes again before it reconnects.
      const live = gated();
      postProfilePictures.mockImplementation(async (args: Args) => {
        live.sent();
        await live.gate;
        return picturesFor('https://x/file/older')(args);
      });
      const refreshed = pictures.refreshProfilePicture(id);
      await live.wasSent;
      postProfilePictures.mockImplementation(picturesFor('https://x/file/new'));
      vi.useFakeTimers();
      pictures.invalidateProfilePicturesOnReconnect();
      live.release();
      await refreshed;
      await vi.advanceTimersByTimeAsync(AFTER_RECONNECT_MS);
      expect(avatar.url()).toBe('https://x/file/new');
    });
    it('splits many mounted avatars into requests of at most 100 ids', async () => {
      postProfilePictures.mockImplementation(picturesFor('https://x/file/1'));
      const ids = Array.from(
        { length: 250 },
        (_, i) => `macro|many${i}@example.com`
      );
      const avatars = ids.map(mount);
      await vi.waitFor(() =>
        expect(avatars.every((a) => a.url() === 'https://x/file/1')).toBe(true)
      );
      postProfilePictures.mockClear();

      vi.useFakeTimers();
      pictures.invalidateProfilePicturesOnReconnect();
      await vi.advanceTimersByTimeAsync(AFTER_RECONNECT_MS);
      expect(requestedIds().map((batch) => batch.length)).toEqual([
        100, 100, 50,
      ]);
      expect(requestedIds().flat().sort()).toEqual([...ids].sort());
    });

    it('still refetches a user one of two avatars shows', async () => {
      const id = 'macro|two-avatars@example.com';
      postProfilePictures.mockImplementation(picturesFor('https://x/file/1'));
      const first = mount(id);
      const second = mount(id);
      await vi.waitFor(() => expect(second.url()).toBe('https://x/file/1'));
      first.unmount();
      postProfilePictures.mockClear();

      postProfilePictures.mockImplementation(picturesFor('https://x/file/2'));
      vi.useFakeTimers();
      pictures.invalidateProfilePicturesOnReconnect();
      await vi.advanceTimersByTimeAsync(AFTER_RECONNECT_MS);
      expect(requestedIds()).toEqual([[id]]);
      expect(second.url()).toBe('https://x/file/2');
    });

    it('waits for the refetch already in flight when a stale picture is read', async () => {
      const id = 'macro|read-in-flight@example.com';
      postProfilePictures.mockImplementation(picturesFor('https://x/file/old'));
      const avatar = mount(id);
      await vi.waitFor(() => expect(avatar.url()).toBe('https://x/file/old'));

      const fetch = gated();
      postProfilePictures.mockImplementation(async (args: Args) => {
        fetch.sent();
        await fetch.gate;
        return picturesFor('https://x/file/new')(args);
      });
      vi.useFakeTimers();
      pictures.invalidateProfilePicturesOnReconnect();
      await vi.advanceTimersByTimeAsync(AFTER_RECONNECT_MS);
      await fetch.wasSent;
      vi.useRealTimers();

      const read = pictures.getProfilePictureUrl(id);
      fetch.release();
      expect(await read).toBe('https://x/file/new');
      expect(postProfilePictures).toHaveBeenCalledTimes(2);
    });
  });

  describe('ordering', () => {
    it('keeps a live update when an older request answers after it', async () => {
      const id = 'macro|race@example.com';
      postProfilePictures.mockImplementation(picturesFor('https://x/file/1'));
      await pictures.getProfilePictureUrl(id);

      const first = gated();
      let calls = 0;
      postProfilePictures.mockImplementation(async (args: Args) => {
        calls += 1;
        if (calls === 1) {
          first.sent();
          await first.gate;
          return picturesFor('https://x/file/stale')(args);
        }
        return picturesFor('https://x/file/new')(args);
      });
      const older = pictures.refreshProfilePicture(id);
      await first.wasSent;
      await pictures.refreshProfilePicture(id);
      first.release();
      await older;
      expect(await pictures.getProfilePictureUrl(id)).toBe(
        'https://x/file/new'
      );
    });

    it('keeps a live update when an older first load answers in between', async () => {
      const id = 'macro|race-queue@example.com';
      const first = gated();
      const live = gated();
      let calls = 0;
      postProfilePictures.mockImplementation(async (args: Args) => {
        calls += 1;
        if (calls === 1) {
          first.sent();
          await first.gate;
          return picturesFor('https://x/file/stale')(args);
        }
        live.sent();
        await live.gate;
        return picturesFor('https://x/file/new')(args);
      });

      // The first load is sent, then the live refetch; the first load
      // answers before the live one.
      const loaded = pictures.getProfilePictureUrl(id);
      await first.wasSent;
      const refreshed = pictures.refreshProfilePicture(id);
      await live.wasSent;
      first.release();
      await loaded;
      await tick();
      live.release();
      await refreshed;
      expect(await pictures.getProfilePictureUrl(id)).toBe(
        'https://x/file/new'
      );
    });

    it('keeps a picture set locally over a response requested before it', async () => {
      const id = 'macro|uploaded@example.com';
      const fetch = gated();
      postProfilePictures.mockImplementation(async (args: Args) => {
        fetch.sent();
        await fetch.gate;
        return picturesFor('https://x/file/server')(args);
      });
      const [url, controls] = createRoot(() =>
        pictures.useProfilePictureUrl(id)
      );
      await fetch.wasSent;
      controls.mutate({
        id,
        url: 'https://x/file/uploaded',
        loading: false,
        _createdAt: new Date(),
      });
      fetch.release();
      await vi.waitFor(() => expect(postProfilePictures).toHaveBeenCalled());
      await tick();
      expect(url()).toBe('https://x/file/uploaded');
    });
  });
});
