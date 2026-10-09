import { expect, it, vi } from 'vitest';
import { createTrailingRefetch } from './trailing-refetch';

it.each([false, true])(
  'coalesces bursts and follows intervening invalidations after failure=%s',
  async (fail) => {
    let complete!: () => void;
    const fetch = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve, reject) => {
            complete = () =>
              fail ? reject(new Error('old read failed')) : resolve();
          })
      )
      .mockResolvedValue(undefined);
    const refresh = createTrailingRefetch(() => true, fetch);
    const first = refresh();
    const duplicate = refresh();
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    const newer = refresh();
    complete();
    await Promise.all([first, duplicate, newer]);
    expect(fetch).toHaveBeenCalledTimes(2);
    await refresh();
    expect(fetch).toHaveBeenCalledTimes(3);
  }
);

it('does not run a trailing read after its owner is disabled', async () => {
  let enabled = true;
  let complete!: () => void;
  const fetch = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        complete = resolve;
      })
  );
  const refresh = createTrailingRefetch(() => enabled, fetch);
  const first = refresh();
  await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
  const newer = refresh();
  enabled = false;
  complete();
  await Promise.all([first, newer, refresh()]);
  expect(fetch).toHaveBeenCalledOnce();
});
