import { expect, test } from 'bun:test';
import { Lazy } from '../src/utils/lazy';

test('a cleared in-flight read cannot restore the cached value', async () => {
  const first = Promise.withResolvers<string>();
  let loads = 0;
  const lazy = new Lazy(() => {
    loads++;
    return loads === 1 ? first.promise : Promise.resolve('current');
  });
  const pending = lazy.get();
  expect(lazy.get()).toBe(pending);
  expect(loads).toBe(1);
  lazy.clear();
  first.resolve('old');
  expect(await pending).toBe('old');
  expect(lazy.peek()).toBeUndefined();
  expect(await lazy.get()).toBe('current');
  expect(loads).toBe(2);
});

test('an older load cannot overwrite a completed post-clear read', async () => {
  const first = Promise.withResolvers<string>();
  const second = Promise.withResolvers<string>();
  let loads = 0;
  const lazy = new Lazy(() => (++loads === 1 ? first.promise : second.promise));
  const oldRead = lazy.get();
  lazy.clear();
  const currentRead = lazy.get();
  expect(lazy.get()).toBe(currentRead);
  expect(loads).toBe(2);
  second.resolve('current');
  expect(await currentRead).toBe('current');
  first.resolve('old');
  expect(await oldRead).toBe('old');
  expect(await lazy.get()).toBe('current');
  expect(loads).toBe(2);
});

test('listed fields serve reads until a load, set or clear supersedes them', async () => {
  let loads = 0;
  const lazy = new Lazy(async () => {
    loads++;
    return { name: 'loaded', kind: 'loaded' };
  });

  lazy.know({ name: 'listed', kind: undefined });
  expect(lazy.listedField('name')).toBe('listed');
  expect(lazy.listedField('kind')).toBeUndefined();
  expect(lazy.peek()).toBeUndefined();

  await lazy.get();
  expect(loads).toBe(1);
  expect(lazy.listedField('name')).toBeUndefined();

  lazy.clear();
  lazy.know({ name: 'listed' });
  lazy.set({ name: 'written', kind: 'written' });
  expect(lazy.listedField('name')).toBeUndefined();

  lazy.know({ name: 'listed' });
  lazy.clear();
  expect(lazy.listedField('name')).toBeUndefined();
});
