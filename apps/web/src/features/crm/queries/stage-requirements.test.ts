import { QueryClient } from '@tanstack/solid-query';
import { okAsync } from 'neverthrow';
import { createRoot } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { CrmRecordDependencies } from './dependencies';
import { crmKeys } from './keys';
import { useStageRequirements } from './stage-requirements';

function deps() {
  const read = vi.fn(() =>
    okAsync([
      { stageColumnId: 'stage', stageId: 'proposal', requiredColumnIds: ['a'] },
    ])
  );
  return {
    read,
    deps: {
      client: new QueryClient({
        defaultOptions: { queries: { retry: false } },
      }),
      storage: { getCrmPipelineStageRequirements: read },
    } as unknown as CrmRecordDependencies,
  };
}

function mount(
  current: CrmRecordDependencies,
  options?: Parameters<typeof useStageRequirements>[2]
) {
  return createRoot((dispose) => ({
    dispose,
    requirements: useStageRequirements(current, 'pipeline', options),
  }));
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

it('polls for the pipeline page', async () => {
  const { read, deps: current } = deps();
  const page = mount(current);
  try {
    await vi.waitFor(() =>
      expect(page.requirements.query.isSuccess).toBe(true)
    );
    await vi.advanceTimersByTimeAsync(10_000);
    expect(read.mock.calls.length).toBeGreaterThanOrEqual(3);
  } finally {
    page.dispose();
  }
});

it('reads once for a caller that does not poll, even when it mounts again', async () => {
  const { read, deps: current } = deps();
  const first = mount(current, { poll: false });
  await vi.waitFor(() =>
    expect(first.requirements.query.data).toEqual([
      { columnId: 'stage', optionId: 'proposal', fields: ['a'] },
    ])
  );
  await vi.advanceTimersByTimeAsync(30_000);
  first.dispose();
  const again = mount(current, { poll: false });
  try {
    await vi.advanceTimersByTimeAsync(30_000);
    expect(again.requirements.query.isSuccess).toBe(true);
    expect(read).toHaveBeenCalledOnce();
  } finally {
    again.dispose();
  }
});

it('keeps the pipeline page polling while a one-off reader shares its query', async () => {
  const { read, deps: current } = deps();
  const page = mount(current);
  const menu = mount(current, { poll: false });
  try {
    await vi.waitFor(() =>
      expect(menu.requirements.query.isSuccess).toBe(true)
    );
    const before = read.mock.calls.length;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(read.mock.calls.length - before).toBeGreaterThanOrEqual(2);
  } finally {
    menu.dispose();
    page.dispose();
  }
});

it('reads again for a one-off reader once its requirements are invalidated', async () => {
  const { read, deps: current } = deps();
  const menu = mount(current, { poll: false });
  try {
    await vi.waitFor(() =>
      expect(menu.requirements.query.isSuccess).toBe(true)
    );
    await current.client.invalidateQueries({
      queryKey: crmKeys.stageRequirements('pipeline').queryKey,
    });
    expect(read).toHaveBeenCalledTimes(2);
  } finally {
    menu.dispose();
  }
});
