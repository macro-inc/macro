import { expect, test } from 'vitest';
import { createNativeMediaUploadEvents } from './native-upload-events';

test('a stale generation can cancel without settling a newer follower', async () => {
  const events = createNativeMediaUploadEvents();
  const first = Promise.withResolvers<undefined>();
  const second = Promise.withResolvers<{ id: string; url: string }>();
  const old: string[] = [];
  const current: string[] = [];
  const url = 'blob:fixture';
  events.subscribe('image', 1, url, {
    start: () => old.push('start'),
    cancelled: () => old.push('cancelled'),
    success: () => old.push('success'),
    failure: () => old.push('failure'),
  });
  events.subscribe('image', 2, url, {
    start: () => current.push('start'),
    cancelled: () => current.push('cancelled'),
    success: ({ id }) => current.push(id),
    failure: () => current.push('failure'),
  });
  events.subscribe('video', 2, url, {
    start: () => current.push('unexpected-video-start'),
    cancelled: () => current.push('unexpected-video-cancellation'),
    success: () => current.push('unexpected-video-success'),
    failure: () => current.push('unexpected-video-failure'),
  });
  const stale = events.track('image', 1, url, () => first.promise);
  const live = events.track('image', 2, url, () => second.promise);
  expect(events.pending('image', 1, url)).toBe(true);
  expect(events.pending('image', 2, url)).toBe(true);
  first.resolve(undefined);
  await stale;
  expect(old).toEqual(['start', 'cancelled']);
  expect(events.pending('image', 1, url)).toBe(false);
  expect(events.pending('image', 2, url)).toBe(true);
  expect(current).toEqual(['start']);
  second.resolve({ id: 'fixture-file', url: 'https://example.com/fixture' });
  await live;
  expect(current).toEqual(['start', 'fixture-file']);
  expect(events.pending('image', 2, url)).toBe(false);
  events.dispose();
});
