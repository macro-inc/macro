import { queryClient } from '@queries/client';
import type {
  ScheduledAction,
  ScheduledActionResponse,
} from '@service-scheduled-action/generated/schemas';
import { cleanup, render } from '@solidjs/testing-library';
import { QueryClientProvider } from '@tanstack/solid-query';
import { err, ok } from 'neverthrow';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RoutineRowOperations } from '../context/routine-sources';
import { scheduledActionKeys } from './keys';
import { createRoutineRowOperations } from './routine-sources';

const client = vi.hoisted(() => ({
  listSchedules: vi.fn(),
  listSubRoutines: vi.fn(),
  listChildren: vi.fn(),
  runNow: vi.fn(),
  createSchedule: vi.fn(),
  detach: vi.fn(),
  stopRun: vi.fn(),
}));
vi.mock('@service-scheduled-action/client', () => ({
  scheduledActionClient: client,
}));
vi.mock('@app/lib/analytics', () => ({ analytics: { track: vi.fn() } }));
vi.mock('@queries/client', async () => {
  const { QueryClient } = await import('@tanstack/solid-query');
  return { queryClient: new QueryClient() };
});

const routine = (id: string, name: string): ScheduledAction => ({
  id,
  owner: 'macro|owner@example.com',
  name,
  kind: 'Agent',
  task: { steps: [] },
  trigger: { type: 'cron', schedule: '0 0 9 * * *', timezone: 'UTC' },
  configuration_revision: 1,
  enabled: true,
  run_visibility: 'unlisted',
  created_at: '2026-09-28T00:00:00Z',
  updated_at: '2026-09-28T00:00:00Z',
  next_run_at: '2026-09-29T09:00:00Z',
});
const briefing = routine('briefing', 'Morning briefing');
const digest = routine('digest', 'Weekly digest');

const callbacks = {
  onError: vi.fn(),
  onRunStarted: vi.fn(),
  onDuplicated: vi.fn(),
  onKept: vi.fn(),
};

function mount(): RoutineRowOperations {
  let operations!: RoutineRowOperations;
  function Probe() {
    operations = createRoutineRowOperations(callbacks);
    return null;
  }
  render(() => (
    <QueryClientProvider client={queryClient}>
      <Probe />
    </QueryClientProvider>
  ));
  return operations;
}

/** A claim stamped `offset` ms from now: recent enough to read as running. */
const claimAt = (offset: number) => new Date(Date.now() + offset).toISOString();

/** Mount with `routine` beside the digest, from the cache and its refetches. */
function mountWithList(routine: ScheduledActionResponse): RoutineRowOperations {
  queryClient.setQueryData(scheduledActionKeys.list.queryKey, [
    routine,
    digest,
  ]);
  client.listSchedules.mockResolvedValue(ok([routine, digest]));
  return mount();
}

/** Write the list as a sync or refetch would, and wait until the rows show it. */
async function showList(
  operations: RoutineRowOperations,
  label: string,
  routine: ScheduledActionResponse
) {
  const marked = { ...routine, name: `${routine.name} (${label})` };
  queryClient.setQueryData(scheduledActionKeys.list.queryKey, [marked, digest]);
  client.listSchedules.mockResolvedValue(ok([marked, digest]));
  await vi.waitFor(() =>
    expect(operations.entity(marked.id ?? '')?.name).toBe(marked.name)
  );
}

/** The next call of `fn` answers when the test says so. */
function answerLater(fn: ReturnType<typeof vi.fn>) {
  let answer!: (result: unknown) => void;
  fn.mockReturnValueOnce(
    new Promise((resolve) => {
      answer = resolve;
    })
  );
  return answer;
}

beforeEach(() => {
  for (const fn of Object.values(client)) fn.mockReset();
  for (const fn of Object.values(callbacks)) fn.mockReset();
  client.listSchedules.mockResolvedValue(ok([briefing, digest]));
  client.listSubRoutines.mockResolvedValue(ok([]));
  queryClient.setQueryData(scheduledActionKeys.list.queryKey, [
    briefing,
    digest,
  ]);
});

afterEach(() => {
  cleanup();
  queryClient.clear();
});

describe('routine row operations', () => {
  it('keeps each routine’s run pending until its own answer arrives', async () => {
    const answerBriefing = answerLater(client.runNow);
    const answerDigest = answerLater(client.runNow);
    const operations = mount();

    operations.run('briefing');
    operations.run('digest');
    // A second Run now on a pending routine sends nothing.
    operations.run('briefing');
    await vi.waitFor(() => expect(client.runNow).toHaveBeenCalledTimes(2));
    expect(operations.runPending('briefing')).toBe(true);
    expect(operations.runPending('digest')).toBe(true);

    answerDigest(ok({}));
    await vi.waitFor(() => expect(operations.runPending('digest')).toBe(false));
    expect(operations.runPending('briefing')).toBe(true);

    answerBriefing(err([{ message: 'Busy' }]));
    await vi.waitFor(() =>
      expect(operations.runPending('briefing')).toBe(false)
    );
    expect(client.runNow).toHaveBeenCalledTimes(2);
    expect(callbacks.onRunStarted).toHaveBeenCalledOnce();
    expect(callbacks.onError).toHaveBeenCalledExactlyOnceWith(
      'run',
      expect.anything()
    );
  });

  it('keeps a stopped run stopping until that run ends, not the next one', async () => {
    const operations = mountWithList({ ...briefing, claimed: claimAt(0) });
    client.stopRun.mockResolvedValueOnce(ok(undefined));

    operations.stop('briefing');
    expect(operations.stopPending('briefing')).toBe(true);
    await vi.waitFor(() => expect(queryClient.isMutating()).toBe(0));
    expect(client.stopRun).toHaveBeenCalledOnce();
    // The request returned, but the run hasn't ended yet.
    expect(operations.stopPending('briefing')).toBe(true);
    expect(operations.stopPending('digest')).toBe(false);

    // A refetch stamps the same run with the server's clock, which can be
    // behind or ahead of the browser's.
    await showList(operations, 'refetched', {
      ...briefing,
      claimed: claimAt(5_000),
    });
    expect(operations.stopPending('briefing')).toBe(true);

    // Its end arrives: the claim is released.
    await showList(operations, 'ended', { ...briefing, claimed: null });
    expect(operations.stopPending('briefing')).toBe(false);

    // A later run, whatever its stamp, is one nobody stopped.
    await showList(operations, 'next run', {
      ...briefing,
      claimed: claimAt(-5_000),
    });
    expect(operations.stopPending('briefing')).toBe(false);
  });

  it('holds no stop for a run that ended while the stop was on its way', async () => {
    const operations = mountWithList({ ...briefing, claimed: claimAt(0) });
    const answer = answerLater(client.stopRun);

    operations.stop('briefing');
    await vi.waitFor(() => expect(client.stopRun).toHaveBeenCalledOnce());
    await showList(operations, 'ended', { ...briefing, claimed: null });
    answer(ok(undefined));
    await vi.waitFor(() => expect(queryClient.isMutating()).toBe(0));

    await showList(operations, 'next run', {
      ...briefing,
      claimed: claimAt(1_000),
    });
    expect(operations.stopPending('briefing')).toBe(false);
  });

  it('releases a stop when the run’s end and the next run arrive together', async () => {
    const operations = mountWithList({ ...briefing, claimed: claimAt(0) });
    client.stopRun.mockResolvedValueOnce(ok(undefined));

    operations.stop('briefing');
    await vi.waitFor(() => expect(queryClient.isMutating()).toBe(0));
    expect(operations.stopPending('briefing')).toBe(true);

    // A refetch after a missed sync: the stopped run is the last run now,
    // and the next one already holds the claim.
    await showList(operations, 'next run', {
      ...briefing,
      claimed: claimAt(1_000),
      last_run: {
        id: 'stopped-run',
        action_id: 'briefing',
        created_at: claimAt(0),
        start_time: claimAt(0),
        end_time: claimAt(500),
        is_success: false,
        result: { status: 'stopped' },
      },
    });
    expect(operations.stopPending('briefing')).toBe(false);
  });

  it('keeps a stop while its routine is briefly out of the list', async () => {
    const operations = mountWithList({ ...briefing, claimed: claimAt(0) });
    client.stopRun.mockResolvedValueOnce(ok(undefined));

    operations.stop('briefing');
    await vi.waitFor(() => expect(queryClient.isMutating()).toBe(0));
    queryClient.setQueryData(scheduledActionKeys.list.queryKey, [digest]);
    await vi.waitFor(() =>
      expect(operations.entity('briefing')).toBeUndefined()
    );

    await showList(operations, 'back', { ...briefing, claimed: claimAt(0) });
    expect(operations.stopPending('briefing')).toBe(true);
  });

  it('rereads the list after a stop, in case no end is sent', async () => {
    const operations = mountWithList({ ...briefing, claimed: claimAt(0) });
    client.stopRun.mockResolvedValueOnce(ok(undefined));
    const reads = client.listSchedules.mock.calls.length;

    operations.stop('briefing');
    await vi.waitFor(() =>
      expect(client.listSchedules.mock.calls.length).toBeGreaterThan(reads)
    );
  });

  it('offers Stop again when the run’s end never arrives', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    try {
      const operations = mountWithList({ ...briefing, claimed: claimAt(0) });
      client.stopRun.mockResolvedValueOnce(ok(undefined));

      operations.stop('briefing');
      await vi.waitFor(() => expect(client.stopRun).toHaveBeenCalledOnce());
      await vi.advanceTimersByTimeAsync(14_000);
      expect(operations.stopPending('briefing')).toBe(true);
      await vi.advanceTimersByTimeAsync(2_000);
      expect(operations.stopPending('briefing')).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('lets a stop go once the run’s claim is stale', async () => {
    const operations = mountWithList({ ...briefing, claimed: claimAt(0) });
    client.stopRun.mockResolvedValueOnce(ok(undefined));

    operations.stop('briefing');
    await vi.waitFor(() => expect(queryClient.isMutating()).toBe(0));
    expect(operations.stopPending('briefing')).toBe(true);

    // The executor died: the claim stays, older than any run may last.
    await showList(operations, 'stale', {
      ...briefing,
      claimed: claimAt(-21 * 60_000),
    });
    expect(operations.stopPending('briefing')).toBe(false);
  });

  it('releases a stop the server refused', async () => {
    queryClient.setQueryData(scheduledActionKeys.list.queryKey, [
      { ...briefing, claimed: '2026-09-29T09:00:00Z' },
      digest,
    ]);
    client.stopRun.mockResolvedValueOnce(err([{ message: 'Down' }]));
    const operations = mount();

    operations.stop('briefing');
    await vi.waitFor(() =>
      expect(operations.stopPending('briefing')).toBe(false)
    );
    expect(callbacks.onError).toHaveBeenCalledExactlyOnceWith(
      'stop',
      expect.anything()
    );
  });

  it('duplicates a second routine while the first copy is saving', async () => {
    const answerFirst = answerLater(client.createSchedule);
    client.createSchedule.mockResolvedValueOnce(
      ok(routine('digest-copy', 'Weekly digest copy'))
    );
    const operations = mount();

    operations.duplicate('briefing');
    operations.duplicate('digest');
    answerFirst(ok(routine('briefing-copy', 'Morning briefing copy')));

    await vi.waitFor(() =>
      expect(callbacks.onDuplicated).toHaveBeenCalledTimes(2)
    );
    expect(client.createSchedule.mock.calls.map(([body]) => body.name)).toEqual(
      ['Morning briefing copy', 'Weekly digest copy']
    );
  });

  it('counts finished one-time routines among those a delete removes', async () => {
    client.listChildren.mockResolvedValueOnce(
      ok([routine('active', 'Active'), routine('finished', 'Finished')])
    );
    const operations = mount();

    await expect(operations.createdCount('briefing')).resolves.toBe(2);
    expect(client.listChildren).toHaveBeenCalledWith({
      scheduleId: 'briefing',
    });

    client.listChildren.mockResolvedValueOnce(err([{ message: 'Down' }]));
    await expect(operations.createdCount('digest')).resolves.toBeUndefined();
  });
});
