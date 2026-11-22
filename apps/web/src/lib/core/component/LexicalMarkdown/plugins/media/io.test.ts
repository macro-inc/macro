import { staticFileIdEndpoint } from '@core/constant/servers';
import { afterEach, expect, test, vi } from 'vitest';
import { getMediaUrl } from './io';

afterEach(() => vi.restoreAllMocks());

test('a stored null source type reaches the unknown-source warning unchanged', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const src = { type: null, id: null, url: '' };
  const url = await getMediaUrl(src);
  expect(url._unsafeUnwrap()).toBe('');
  expect(warn).toHaveBeenCalledWith('Get media url failed for src:', src);
});

test('a stored null static-file id interpolates into the endpoint as before', async () => {
  const url = await getMediaUrl({ type: 'sfs', id: null, url: '' });
  expect(url._unsafeUnwrap()).toBe(staticFileIdEndpoint('null'));
});
