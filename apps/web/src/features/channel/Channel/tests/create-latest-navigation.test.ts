import { describe, expect, it, vi } from 'vitest';
import { createLatestNavigation } from '../create-latest-navigation';

function pendingLoad() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('latest navigation', () => {
  it('ignores a page that finishes loading after navigation was cancelled', async () => {
    const load = pendingLoad();
    const scroll = vi.fn(() => true);
    const navigation = createLatestNavigation({
      loadLatest: () => load.promise,
      scroll,
    });
    const request = navigation.goToLatest();
    navigation.cancel();
    load.resolve();
    await request;
    navigation.onLayout();
    expect(scroll).not.toHaveBeenCalled();
  });
});
