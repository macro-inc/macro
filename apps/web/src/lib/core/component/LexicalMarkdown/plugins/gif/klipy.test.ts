import { initializePlatformFetch } from '@core/util/platformFetch';
import { expect, it, vi } from 'vitest';
import { fetchTrendingGifs, searchGifs } from './klipy';

it('sends public GIF requests directly through the browser transport', async () => {
  const browser = vi
    .fn<typeof fetch>()
    .mockImplementation(async () => Response.json({ results: [] }));
  const native = vi.fn<typeof fetch>();
  initializePlatformFetch(browser);
  vi.stubGlobal('fetch', native);
  try {
    await fetchTrendingGifs();
    await searchGifs('example');
    expect(browser).toHaveBeenCalledTimes(2);
    expect(native).not.toHaveBeenCalled();
  } finally {
    vi.unstubAllGlobals();
  }
});
