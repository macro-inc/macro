import { createRoot, createSignal } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import {
  createAutomaticTaskPagination,
  type TaskPageSource,
} from './automatic-task-pagination';

let dispose: (() => void) | undefined;
afterEach(() => dispose?.());
function setup(
  sources: () => TaskPageSource[],
  enabled = () => true,
  scope = () => 'project'
) {
  return createRoot((cleanup) => {
    dispose = cleanup;
    return createAutomaticTaskPagination({ sources, enabled, scope });
  });
}

it('drains every group independently without duplicate in-flight requests', async () => {
  const [pages, setPages] = createSignal([3, 2]);
  const pending = Promise.withResolvers<void>();
  const load = vi.fn(async (index: number) => {
    await pending.promise;
    setPages((counts) =>
      counts.map((count, i) => (i === index ? count - 1 : count))
    );
  });
  setup(() =>
    pages().map((count, index) => ({
      id: String(index),
      hasMore: count > 0,
      pending: false,
      load: () => load(index),
      error: () => null,
    }))
  );
  expect(load).toHaveBeenCalledTimes(2);
  pending.resolve();
  await vi.waitFor(() => expect(pages()).toEqual([0, 0]));
  expect(load).toHaveBeenCalledTimes(5);
});

it('stops after a resolved query failure and resumes only on retry', async () => {
  const [remaining, setRemaining] = createSignal(true);
  let failure: Error | null = new Error('Offline');
  const load = vi.fn(async () => {
    if (!failure) setRemaining(false);
  });
  const pagination = setup(() => [
    {
      id: 'group',
      hasMore: remaining(),
      pending: false,
      load,
      error: () => failure,
    },
  ]);
  await vi.waitFor(() => expect(pagination.error()).toBe(failure));
  expect(load).toHaveBeenCalledOnce();
  failure = null;
  pagination.retry();
  await vi.waitFor(() => expect(remaining()).toBe(false));
  expect(load).toHaveBeenCalledTimes(2);
});

it('does not continue fetching when access is lost during a request', async () => {
  const [enabled, setEnabled] = createSignal(true);
  const pending = Promise.withResolvers<void>();
  const load = vi.fn(() => pending.promise);
  setup(
    () => [
      { id: 'group', hasMore: true, pending: false, load, error: () => null },
    ],
    enabled
  );
  setEnabled(false);
  pending.resolve();
  await pending.promise;
  await Promise.resolve();
  expect(load).toHaveBeenCalledOnce();
});

it('ignores a stale request failure after the project or filters change', async () => {
  const [scope, setScope] = createSignal('old');
  const [remaining, setRemaining] = createSignal(true);
  const pending = Promise.withResolvers<void>();
  const pagination = setup(
    () => [
      {
        id: 'group',
        hasMore: remaining(),
        pending: false,
        load:
          scope() === 'old'
            ? () => pending.promise
            : async () => {
                setRemaining(false);
              },
        error: () => null,
      },
    ],
    () => true,
    scope
  );
  setScope('new');
  pending.reject(new Error('Old request failed'));
  await vi.waitFor(() => expect(remaining()).toBe(false));
  expect(pagination.error()).toBeUndefined();
});
