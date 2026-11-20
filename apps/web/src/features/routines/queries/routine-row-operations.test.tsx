import { queryClient } from '@queries/client';
import type { ScheduledAction } from '@service-scheduled-action/generated/schemas';
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
