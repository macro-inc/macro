// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';
import {
  loadRecentBackgroundImages,
  MAX_RECENT_IMAGE_LENGTH,
  removeRecentBackgroundImage,
  saveRecentBackgroundImage,
} from './recent-background-images';

describe('recent background images', () => {
  it('deduplicates, reorders, evicts the oldest and persists removals', async () => {
    for (const path of ['a', 'b', 'c', 'd', 'e'])
      await saveRecentBackgroundImage({ id: 'custom', path });
    await saveRecentBackgroundImage({ id: 'custom', path: 'b' });
    expect(
      (await loadRecentBackgroundImages()).map((image) => image.path)
    ).toEqual(['b', 'e', 'd', 'c', 'a']);
    await saveRecentBackgroundImage({ id: 'custom', path: 'f' });
    expect(
      (await loadRecentBackgroundImages()).map((image) => image.path)
    ).toEqual(['f', 'b', 'e', 'd', 'c']);
    await removeRecentBackgroundImage('e');
    expect(
      (await loadRecentBackgroundImages()).map((image) => image.path)
    ).toEqual(['f', 'b', 'd', 'c']);
  });

  it('does not store images over the per-image limit or mutate on write failure', async () => {
    expect(
      await saveRecentBackgroundImage({
        id: 'custom',
        path: 'a'.repeat(MAX_RECENT_IMAGE_LENGTH + 1),
      })
    ).toBeNull();
    const before = await loadRecentBackgroundImages();
    const transaction = IDBDatabase.prototype.transaction;
    vi.spyOn(IDBDatabase.prototype, 'transaction').mockImplementationOnce(
      function (this: IDBDatabase, ...args) {
        if (args[1] === 'readwrite') throw new Error('Storage unavailable');
        return transaction.apply(this, args);
      }
    );
    await expect(
      saveRecentBackgroundImage({ id: 'custom', path: 'failed' })
    ).rejects.toThrow('Storage unavailable');
    expect(await loadRecentBackgroundImages()).toEqual(before);
    vi.restoreAllMocks();
  });
});
