import { expect, test } from 'vitest';
import { createNativeMediaUploadEvents } from './native-upload-events';

test('a stale generation can cancel without settling a newer follower', async () => {
  const events = createNativeMediaUploadEvents();
  const first = Promise.withResolvers<undefined>();
  const second = Promise.withResolvers<{ id: string; url: string }>();
  const old: string[] = [];
  const current: string[] = [];
  const url = 'blob:fixture';
  events.subscribe(1, url, {
    start: () => old.push('start'),
    cancelled: () => old.push('cancelled'),
    success: () => old.push('success'),
    failure: () => old.push('failure'),
  });
  events.subscribe(2, url, {
    start: () => current.push('start'),
    cancelled: () => current.push('cancelled'),
    success: ({ id }) => current.push(id),
    failure: () => current.push('failure'),
  });
  const stale = events.track(1, url, () => first.promise);
  const live = events.track(2, url, () => second.promise);
  expect(events.pending(1, url)).toBe(true);
  expect(events.pending(2, url)).toBe(true);
  first.resolve(undefined);
  await stale;
  expect(old).toEqual(['start', 'cancelled']);
  expect(events.pending(1, url)).toBe(false);
  expect(events.pending(2, url)).toBe(true);
  expect(current).toEqual(['start']);
  second.resolve({ id: 'fixture-file', url: 'https://example.com/fixture' });
  await live;
  expect(current).toEqual(['start', 'fixture-file']);
  expect(events.pending(2, url)).toBe(false);
  events.dispose();
});
