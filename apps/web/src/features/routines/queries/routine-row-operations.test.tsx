import { queryClient } from '@queries/client';
import type { ScheduledAction } from '@service-scheduled-action/generated/schemas';
import { cleanup, render } from '@solidjs/testing-library';
import { QueryClientProvider } from '@tanstack/solid-query';
import { err, ok } from 'neverthrow';
import { createEffect, createSignal } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RoutineRowOperations } from '../context/routine-sources';
import { scheduledActionKeys } from './keys';
import {
  createRoutineListSource,
  createRoutineRowOperations,
} from './routine-sources';

const client = vi.hoisted(() => ({
  listSchedules: vi.fn(),
  listSubRoutines: vi.fn(),
  listChildren: vi.fn(),
  runNow: vi.fn(),
  createSchedule: vi.fn(),
  detach: vi.fn(),
}));
const appConnections = vi.hoisted(() => ({
  read: (): ReadonlySet<string> | undefined => new Set(),
  requested: vi.fn(),
}));
vi.mock('@queries/pipedream-connectors', () => ({
  usePipedreamConnectedSlugs: (options?: { enabled?: () => boolean }) => {
    createEffect(() => {
      if (options?.enabled?.() ?? true) appConnections.requested();
    });
    return {
      ready: () => appConnections.read() !== undefined,
      slugs: () => appConnections.read(),
    };
  },
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
let briefing: ScheduledAction;
let digest: ScheduledAction;

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
  // The query store reconciles fetched rows by ID in place.
  briefing = routine('briefing', 'Morning briefing');
  digest = routine('digest', 'Weekly digest');
  appConnections.requested.mockClear();
  appConnections.read = () => new Set();
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
  it('keeps an app-free copy without requesting connection data', async () => {
    appConnections.read = () => undefined;
    const parent: ScheduledAction = {
      ...briefing,
      task: {
        steps: [],
        sub_routines: [
          {
            name: 'remind',
            title: 'Remind',
            steps: [{ type: 'agent', model: 'model', instructions: 'Remind.' }],
          },
        ],
      },
    };
    const copy: ScheduledAction = {
      ...digest,
      sub_routine: { parent_id: 'briefing', created_by_run_id: 'run' },
      task: { sub_routine: 'remind', inputs: {} },
    };
    client.listSchedules.mockResolvedValue(ok([parent]));
    client.listSubRoutines.mockResolvedValue(ok([copy]));
    client.detach.mockResolvedValue(ok(digest));
    let list!: ReturnType<typeof createRoutineListSource>;
    let operations!: RoutineRowOperations;
    function Probe() {
      list = createRoutineListSource(vi.fn());
      operations = createRoutineRowOperations(callbacks);
      return null;
    }
    render(() => (
      <QueryClientProvider client={queryClient}>
        <Probe />
      </QueryClientProvider>
    ));
    await vi.waitFor(() => expect(list.subRoutines()[0]?.id).toBe('digest'));
    expect(list.subRoutines()[0]?.canKeep).toBe(true);
    expect(appConnections.requested).not.toHaveBeenCalled();
    operations.keepAsOwn('digest');
    await vi.waitFor(() => expect(callbacks.onKept).toHaveBeenCalledOnce());
    expect(client.detach).toHaveBeenCalledExactlyOnceWith({
      scheduleId: 'digest',
    });
  });

  it('holds Keep in the list and at dispatch until the sibling’s app is connected', async () => {
    const definition = {
      name: 'remind',
      title: 'Remind',
      steps: [
        { type: 'agent' as const, model: 'model', instructions: 'Remind.' },
      ],
    };
    const parent: ScheduledAction = {
      ...briefing,
      task: {
        steps: [],
        sub_routines: [
          definition,
          {
            ...definition,
            name: 'notify',
            mcp_servers: [{ app_slug: 'example', server_name: 'Example' }],
          },
        ],
      },
    };
    const copy: ScheduledAction = {
      ...digest,
      sub_routine: { parent_id: 'briefing', created_by_run_id: 'run' },
      task: { sub_routine: 'remind', inputs: {} },
    };
    const [slugs, setSlugs] = createSignal<ReadonlySet<string>>();
    appConnections.read = slugs;
    client.listSchedules.mockResolvedValue(ok([parent]));
    client.listSubRoutines.mockResolvedValue(ok([copy]));
    client.detach.mockResolvedValue(ok(digest));
    let list!: ReturnType<typeof createRoutineListSource>;
    let operations!: RoutineRowOperations;
    function Probe() {
      list = createRoutineListSource(vi.fn());
      operations = createRoutineRowOperations(callbacks, () => false);
      return null;
    }
    render(() => (
      <QueryClientProvider client={queryClient}>
        <Probe />
      </QueryClientProvider>
    ));

    await vi.waitFor(() => expect(list.subRoutines()[0]?.id).toBe('digest'));
    expect(list.subRoutines()[0]?.canKeep).toBe(false);
    setSlugs(new Set<string>());
    expect(list.subRoutines()[0]?.canKeep).toBe(false);
    operations.keepAsOwn('digest');
    await Promise.resolve();
    expect(client.detach).not.toHaveBeenCalled();
    setSlugs(new Set(['example']));
    expect(list.subRoutines()[0]?.canKeep).toBe(true);
    operations.keepAsOwn('digest');
    await vi.waitFor(() => expect(callbacks.onKept).toHaveBeenCalledOnce());
    expect(client.detach).toHaveBeenCalledExactlyOnceWith({
      scheduleId: 'digest',
    });
  });

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

  it('withholds Duplicate for elapsed one-time triggers at the menu and dispatch', async () => {
    const elapsed: ScheduledAction = {
      ...briefing,
      enabled: false,
      trigger: { type: 'once', at: '2000-01-01T09:00:00Z' },
    };
    const future: ScheduledAction = {
      ...digest,
      trigger: { type: 'once', at: '2099-01-01T09:00:00Z' },
    };
    client.listSchedules.mockResolvedValue(ok([elapsed, future]));
    queryClient.setQueryData(scheduledActionKeys.list.queryKey, [
      elapsed,
      future,
    ]);
    const operations = mount();
    expect(operations.canDuplicate('briefing')).toBe(false);
    expect(operations.canDuplicate('digest')).toBe(true);
    operations.duplicate('briefing');
    await Promise.resolve();
    expect(client.createSchedule).not.toHaveBeenCalled();
  });

  it('requires connections for retained definitions before duplicating', async () => {
    const saved: ScheduledAction = {
      ...briefing,
      task: {
        steps: [],
        sub_routines: [
          {
            name: 'remind',
            title: 'Remind',
            steps: [{ type: 'agent', model: 'model', instructions: 'Remind.' }],
            mcp_servers: [{ app_slug: 'example', server_name: 'Example' }],
          },
        ],
      },
    };
    const [slugs, setSlugs] = createSignal<ReadonlySet<string>>();
    appConnections.read = slugs;
    client.listSchedules.mockResolvedValue(ok([saved]));
    queryClient.setQueryData(scheduledActionKeys.list.queryKey, [saved]);
    client.createSchedule.mockResolvedValue(ok({ ...saved, id: 'duplicate' }));
    const operations = mount();
    expect(operations.canDuplicate('briefing')).toBe(false);
    setSlugs(new Set<string>());
    expect(appConnections.requested).toHaveBeenCalled();
    expect(operations.canDuplicate('briefing')).toBe(false);
    operations.duplicate('briefing');
    await Promise.resolve();
    expect(client.createSchedule).not.toHaveBeenCalled();

    setSlugs(new Set(['example']));
    expect(operations.canDuplicate('briefing')).toBe(true);
    operations.duplicate('briefing');
    await vi.waitFor(() =>
      expect(callbacks.onDuplicated).toHaveBeenCalledWith('duplicate')
    );
    expect(client.createSchedule.mock.calls[0]?.[0].task).toEqual(saved.task);
  });

  it('duplicates a second routine while the first copy is saving', async () => {
    const answerFirst = answerLater(client.createSchedule);
    client.createSchedule.mockResolvedValueOnce(
      ok(routine('digest-copy', 'Weekly digest copy'))
    );
    const operations = mount();
    expect(operations.canDuplicate('briefing')).toBe(true);
    expect(operations.canDuplicate('digest')).toBe(true);

    operations.duplicate('briefing');
    operations.duplicate('digest');
    await vi.waitFor(() =>
      expect(callbacks.onDuplicated).toHaveBeenCalledExactlyOnceWith(
        'digest-copy'
      )
    );
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
