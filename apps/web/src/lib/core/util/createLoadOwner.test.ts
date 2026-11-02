import { createRoot } from 'solid-js';
import { expect, it, vi } from 'vitest';
import { createLoadOwner } from './createLoadOwner';

it('retires resources arriving after consumer disposal', async () => {
  const pending = Promise.withResolvers<string>();
  const { owner, dispose } = createRoot((dispose) => ({
    owner: createLoadOwner(),
    dispose,
  }));
  const retire = vi.fn();
  const loaded = owner.run(() => pending.promise, retire);
  dispose();
  pending.resolve('source');
  await loaded;
  expect(retire).toHaveBeenCalledExactlyOnceWith('source');
});

it('retires superseded reads while retaining the current read', async () => {
  const first = Promise.withResolvers<string>();
  const second = Promise.withResolvers<string>();
  const { owner, dispose } = createRoot((dispose) => ({
    owner: createLoadOwner(),
    dispose,
  }));
  const retire = vi.fn();
  const oldLoad = owner.run(() => first.promise, retire);
  const newLoad = owner.run(() => second.promise, retire);
  second.resolve('current');
  expect((await newLoad)?.adopt()).toBe('current');
  first.resolve('old');
  await oldLoad;
  expect(retire).toHaveBeenCalledExactlyOnceWith('old');
  dispose();
});

it('retires an invalidated read without cancelling other shared consumers', async () => {
  const pending = Promise.withResolvers<string>();
  const { owner, dispose } = createRoot((dispose) => ({
    owner: createLoadOwner(),
    dispose,
  }));
  const retire = vi.fn();
  const load = owner.run(() => pending.promise, retire);
  owner.invalidate();
  pending.resolve('shared');
  await load;
  expect(await pending.promise).toBe('shared');
  expect(retire).toHaveBeenCalledExactlyOnceWith('shared');
  dispose();
});

it('retires completed data while its module is still pending', async () => {
  const data = Promise.withResolvers<string>();
  const module = Promise.withResolvers<void>();
  const { owner, dispose } = createRoot((dispose) => ({
    owner: createLoadOwner(),
    dispose,
  }));
  const retire = vi.fn();
  const result = owner.run(
    () => data.promise,
    retire,
    () => module.promise
  );
  data.resolve('source');
  await data.promise;
  dispose();
  module.resolve();
  expect(await result).toBeUndefined();
  expect(retire).toHaveBeenCalledExactlyOnceWith('source');
});

it('retires data arriving after its module has failed', async () => {
  const data = Promise.withResolvers<string>();
  const module = Promise.withResolvers<void>();
  const { owner, dispose } = createRoot((dispose) => ({
    owner: createLoadOwner(),
    dispose,
  }));
  const retire = vi.fn();
  const result = owner.run(
    () => data.promise,
    retire,
    () => module.promise
  );
  const failed = expect(result).rejects.toThrow('module failed');
  module.reject(new Error('module failed'));
  await failed;
  data.resolve('source');
  await data.promise;
  expect(retire).toHaveBeenCalledExactlyOnceWith('source');
  dispose();
});

it('keeps ownership until the mounted consumer adopts the published resource', async () => {
  const { owner, dispose } = createRoot((dispose) => ({
    owner: createLoadOwner(),
    dispose,
  }));
  const retire = vi.fn();
  const loaded = await owner.run(async () => 'source', retire);
  expect(loaded?.value).toBe('source');
  dispose();
  expect(loaded?.value).toBeUndefined();
  expect(loaded?.adopt()).toBeUndefined();
  expect(retire).toHaveBeenCalledExactlyOnceWith('source');
});

it('transfers cleanup to the mounted consumer exactly once', async () => {
  const { owner, dispose } = createRoot((dispose) => ({
    owner: createLoadOwner(),
    dispose,
  }));
  const retire = vi.fn();
  const loaded = await owner.run(async () => 'source', retire);
  expect(loaded?.adopt()).toBe('source');
  dispose();
  expect(retire).not.toHaveBeenCalled();
});
