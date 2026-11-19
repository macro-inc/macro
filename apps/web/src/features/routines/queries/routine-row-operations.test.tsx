import { beginInteraction } from '@app/observability/flow';
import { NOOP_SPAN } from '@macro-inc/observability';
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
vi.mock('@app/observability/flow', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@app/observability/flow')>();
  return { ...actual, beginInteraction: vi.fn(actual.beginInteraction) };
});
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
    operations.setMenuOpen('digest', true);
    expect(operations.canKeepAsOwn('digest')).toBe(true);
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
    expect(appConnections.requested).not.toHaveBeenCalled();
    operations.setMenuOpen('digest', true);
    expect(appConnections.requested).toHaveBeenCalledOnce();
    expect(operations.canKeepAsOwn('digest')).toBe(false);
    setSlugs(new Set<string>());
    expect(operations.canKeepAsOwn('digest')).toBe(false);
    operations.keepAsOwn('digest');
    await Promise.resolve();
    expect(client.detach).not.toHaveBeenCalled();
    setSlugs(new Set(['example']));
    expect(operations.canKeepAsOwn('digest')).toBe(true);
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

  it.each([
    'missing definition',
    'incompatible inputs',
    'uncached parent',
  ] as const)(
    'checks the cached parent before dispatching row Run now: %s',
    async (condition) => {
      const copy: ScheduledAction = {
        ...digest,
        sub_routine: { parent_id: 'parent', created_by_run_id: 'run' },
        task: { sub_routine: 'remind', inputs: { item: 'Due today' } },
      };
      const parent: ScheduledAction = {
        ...briefing,
        id: 'parent',
        task: {
          steps: [
            { type: 'agent', model: 'model', instructions: 'Plan reminders.' },
          ],
          sub_routines:
            condition === 'missing definition'
              ? []
              : [
                  {
                    name: 'remind',
                    title: 'Remind',
                    steps: [
                      {
                        type: 'agent',
                        model: 'model',
                        instructions: 'Remind.',
                      },
                    ],
                    inputs: [{ type: 'number', name: 'item', label: 'Item' }],
                  },
                ],
        },
      };
      const rows =
        condition === 'uncached parent' ? [briefing] : [briefing, parent];
      queryClient.setQueryData(scheduledActionKeys.list.queryKey, rows);
      queryClient.setQueryData(scheduledActionKeys.subRoutines.queryKey, [
        copy,
      ]);
      client.listSchedules.mockResolvedValue(ok(rows));
      client.listSubRoutines.mockResolvedValue(ok([copy]));
      client.runNow.mockResolvedValue(ok({}));
      const operations = mount();

      operations.run('digest');
      operations.run('briefing');
      await vi.waitFor(() => expect(callbacks.onRunStarted).toHaveBeenCalled());
      expect(client.runNow.mock.calls).toEqual(
        condition === 'uncached parent'
          ? [[{ scheduleId: 'digest' }], [{ scheduleId: 'briefing' }]]
          : [[{ scheduleId: 'briefing' }]]
      );
    }
  );

  it('duplicates an elapsed one-time trigger using the saved schedule', async () => {
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
    client.createSchedule.mockResolvedValue(ok({ ...elapsed, id: 'copy' }));
    queryClient.setQueryData(scheduledActionKeys.list.queryKey, [
      elapsed,
      future,
    ]);
    const operations = mount();
    expect(operations.canDuplicate('briefing')).toBe(true);
    expect(operations.canDuplicate('digest')).toBe(true);
    operations.duplicate('briefing');
    await vi.waitFor(() =>
      expect(callbacks.onDuplicated).toHaveBeenCalledWith('copy')
    );
    expect(client.createSchedule.mock.calls[0]?.[0].trigger).toEqual(
      elapsed.trigger
    );
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
    expect(appConnections.requested).not.toHaveBeenCalled();
    operations.setMenuOpen('briefing', true);
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

    await expect(operations.createdCount('briefing')).resolves.toEqual({
      count: 2,
      atLeast: false,
    });
    expect(client.listChildren).toHaveBeenCalledWith({
      scheduleId: 'briefing',
    });

    client.listChildren.mockResolvedValueOnce(err([{ message: 'Down' }]));
    await expect(operations.createdCount('digest')).resolves.toBeUndefined();
  });

  it('counts in an interaction of its own, reading in its span even after an earlier read', async () => {
    // How deep the test is in a count span's `run` when the read is sent.
    let inside = 0;
    const counts: {
      span: typeof NOOP_SPAN;
      release: ReturnType<typeof vi.fn>;
    }[] = [];
    vi.mocked(beginInteraction).mockImplementation(() => {
      const span = {
        ...NOOP_SPAN,
        run: <T,>(operation: () => T) => {
          inside += 1;
          try {
            return operation();
          } finally {
            inside -= 1;
          }
        },
        setAttr: vi.fn(),
        error: vi.fn(),
        end: vi.fn(),
      };
      const release = vi.fn();
      counts.push({ span, release });
      return {
        span: { ...NOOP_SPAN, span: () => span },
        hold: () => release,
        end: vi.fn(),
      };
    });
    const sentInSpan: boolean[] = [];
    let answerFirst!: (result: unknown) => void;
    client.listChildren.mockImplementationOnce(() => {
      sentInSpan.push(inside > 0);
      return new Promise((resolve) => {
        answerFirst = resolve;
      });
    });
    client.listChildren.mockImplementation(async () => {
      sentInSpan.push(inside > 0);
      return ok([routine('active', 'Active')]);
    });
    try {
      const operations = mount();
      const first = operations.createdCount('briefing');
      // The second waits the first read out, then reads in its own span.
      const second = operations.createdCount('briefing');
      answerFirst(ok([]));
      await expect(first).resolves.toEqual({ count: 0, atLeast: false });
      await expect(second).resolves.toEqual({ count: 1, atLeast: false });
      expect(sentInSpan).toEqual([true, true]);
      expect(beginInteraction).toHaveBeenCalledWith(
        'routine.delete_count.action',
        { attributes: { 'routine.id': 'briefing' } }
      );
      expect(counts[1]?.span.setAttr).toHaveBeenCalledWith(
        'routine.created.count',
        1
      );
      expect(counts[1]?.release).toHaveBeenCalledExactlyOnceWith('success');

      client.listChildren.mockResolvedValueOnce(err([{ message: 'Down' }]));
      await expect(operations.createdCount('digest')).resolves.toBeUndefined();
      expect(counts[2]?.span.error).toHaveBeenCalledExactlyOnceWith(
        'Routine children read failed'
      );
      expect(counts[2]?.release).toHaveBeenCalledExactlyOnceWith('error');
    } finally {
      vi.mocked(beginInteraction).mockReset();
    }
  });

  it('counts at least the finished routines the scheduler lists, when it lists as many as it can', async () => {
    const finished = (id: string): ScheduledAction => ({
      ...routine(id, id),
      trigger: { type: 'once', at: '2000-01-01T09:00:00Z' },
      next_run_at: null,
    });
    const listed = Array.from({ length: 200 }, (_, i) => finished(`f${i}`));
    // One still running its only firing counts too: the scheduler's rule is
    // a one-time trigger with no next run.
    listed[0] = { ...listed[0], claimed: new Date().toISOString() };
    client.listChildren.mockResolvedValueOnce(
      ok([routine('active', 'Active'), ...listed])
    );
    const operations = mount();
    // The scheduler lists the newest 200 finished ones; a delete removes
    // older ones too.
    await expect(operations.createdCount('briefing')).resolves.toEqual({
      count: 201,
      atLeast: true,
    });

    client.listChildren.mockResolvedValueOnce(
      ok([routine('active', 'Active'), ...listed.slice(1)])
    );
    await expect(operations.createdCount('briefing')).resolves.toEqual({
      count: 200,
      atLeast: false,
    });

    // A routine on another trigger with no run left isn't one of them.
    client.listChildren.mockResolvedValueOnce(
      ok([
        { ...routine('no-run-left', 'No run left'), next_run_at: null },
        ...listed.slice(1),
      ])
    );
    await expect(operations.createdCount('briefing')).resolves.toEqual({
      count: 200,
      atLeast: false,
    });
  });
});
