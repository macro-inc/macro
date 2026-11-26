import { afterEach, describe, expect, test } from 'bun:test';
import {
  Macro,
  NotTimeEntryAuthorError,
  TimeEntry,
  Timer,
  TimerOverLimitError,
} from '../src/macro';
import { MacroError, MacroForbiddenError } from '../src/utils';

const originalFetch = globalThis.fetch;
const host = 'https://storage.example.test';
const taskId = '01a1fa5b-0000-7000-8000-000000000001';
const otherTaskId = '01a1fa5b-0000-7000-8000-000000000002';
const entryId = '01a1fa5b-0000-7000-8000-0000000000e1';
const olderEntryId = '01a1fa5b-0000-7000-8000-0000000000e0';
const timerId = '01a1fa5b-0000-7000-8000-0000000000f1';
const userId = 'macro|logger@example.com';

afterEach(() => {
  globalThis.fetch = originalFetch;
});

interface Seen {
  method: string;
  path: string;
  query: Record<string, string>;
  body: unknown;
}

function serve(handler: (seen: Seen) => Response) {
  const requests: Seen[] = [];
  globalThis.fetch = (async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const url = new URL(request.url);
    const text = await request.text();
    const seen = {
      method: request.method,
      path: url.pathname,
      query: Object.fromEntries(url.searchParams),
      body: text ? JSON.parse(text) : undefined,
    };
    requests.push(seen);
    return handler(seen);
  }) as typeof fetch;
  return requests;
}

function macro() {
  return new Macro({ token: 'user-token', hosts: { storage: host } });
}

function entry(overrides: Record<string, unknown> = {}) {
  return {
    id: entryId,
    taskId,
    userId,
    date: '2026-11-20',
    minutes: 90,
    note: 'Review',
    startedAt: null,
    endedAt: null,
    source: 'manual',
    createdAt: '2026-11-20T10:00:00Z',
    updatedAt: '2026-11-20T10:00:00Z',
    ...overrides,
  };
}

function runningTimer(id = timerId, task = taskId) {
  return { id, taskId: task, startedAt: '2026-11-23T08:00:00Z' };
}

describe('task.logTime', () => {
  test('logs typed time on the task and returns the entry', async () => {
    const requests = serve(() =>
      Response.json({ entry: entry(), totalMinutes: 90 }),
    );
    const task = macro().tasks.byId(taskId);

    const logged = await task.logTime({
      minutes: 90,
      date: '2026-11-20',
      note: 'Review',
      idempotencyKey: entryId,
    });

    expect(requests).toEqual([
      {
        method: 'POST',
        path: `/time/tasks/${taskId}/entries`,
        query: {},
        body: { id: entryId, date: '2026-11-20', minutes: 90, note: 'Review' },
      },
    ]);
    expect(logged).toBeInstanceOf(TimeEntry);
    expect(logged.id).toBe(entryId);
    expect(await logged.minutes()).toBe(90);
    expect(await logged.date()).toBe('2026-11-20');
    expect((await logged.task()).id).toBe(taskId);
    expect((await logged.author()).id).toBe(userId);
    expect(requests).toHaveLength(1);
  });

  test("sends today's UTC day when no date is given", async () => {
    const requests = serve(() =>
      Response.json({ entry: entry(), totalMinutes: 90 }),
    );
    await macro().tasks.byId(taskId).logTime({ minutes: 15 });

    expect(requests[0]?.body).toEqual({
      date: new Date().toISOString().slice(0, 10),
      minutes: 15,
    });
  });

  test('refuses options it does not take, a bad length or a bad day, before any request', async () => {
    const requests = serve(() => Response.json({}));
    const task = macro().tasks.byId(taskId);

    await expect(
      task.logTime({ minutes: 30, user: 'someone' } as never),
    ).rejects.toThrow('task.logTime does not take `user`');
    await expect(task.logTime({ minutes: 1.5 })).rejects.toThrow(
      'a whole number of minutes',
    );
    await expect(task.logTime({ minutes: 0 })).rejects.toThrow(MacroError);
    await expect(
      task.logTime({ minutes: 30, date: '20/11/2026' }),
    ).rejects.toThrow('as YYYY-MM-DD');
    await expect(
      task.logTime({ minutes: 30, date: '2026-02-30' }),
    ).rejects.toThrow('as YYYY-MM-DD');
    await expect(
      TimeEntry.byId(macro()._client, entryId).edit({ date: '2026-13-01' }),
    ).rejects.toThrow('as YYYY-MM-DD');
    expect(requests).toHaveLength(0);
  });

  test('a view-only caller gets the 403 that asks for edit access', async () => {
    serve(() =>
      Response.json(
        {
          code: 'forbidden',
          message: 'you do not have the access this needs on the task',
        },
        { status: 403 },
      ),
    );

    const refusal = macro().tasks.byId(taskId).logTime({ minutes: 30 });

    await expect(refusal).rejects.toBeInstanceOf(MacroForbiddenError);
    await expect(refusal).rejects.not.toBeInstanceOf(NotTimeEntryAuthorError);
  });
});

describe('task.timeEntries', () => {
  test('follows the cursor page by page, newest first', async () => {
    const requests = serve(({ query }) =>
      query.cursorId
        ? Response.json({
            entries: [entry({ id: olderEntryId, date: '2026-11-19' })],
            nextCursor: null,
            totalMinutes: 180,
          })
        : Response.json({
            entries: [entry()],
            nextCursor: { date: '2026-11-20', id: entryId },
            totalMinutes: 180,
          }),
    );

    const ids: string[] = [];
    for await (const found of macro()
      .tasks.byId(taskId)
      .timeEntries({ pageSize: 1 }))
      ids.push(found.id);

    expect(ids).toEqual([entryId, olderEntryId]);
    expect(requests.map((request) => request.query)).toEqual([
      { limit: '1' },
      { limit: '1', cursorDate: '2026-11-20', cursorId: entryId },
    ]);
  });

  test('stops at maxItems without reading another page', async () => {
    const requests = serve(() =>
      Response.json({
        entries: [entry()],
        nextCursor: { date: '2026-11-20', id: entryId },
        totalMinutes: 180,
      }),
    );

    const found: TimeEntry[] = [];
    for await (const item of macro()
      .tasks.byId(taskId)
      .timeEntries({ maxItems: 1 }))
      found.push(item);

    expect(found).toHaveLength(1);
    expect(requests).toHaveLength(1);
  });

  test('timeLogged reads the total in one small request', async () => {
    const requests = serve(() =>
      Response.json({
        entries: [entry()],
        nextCursor: null,
        totalMinutes: 275,
      }),
    );

    expect(await macro().tasks.byId(taskId).timeLogged()).toBe(275);
    expect(requests).toEqual([
      {
        method: 'GET',
        path: `/time/tasks/${taskId}/entries`,
        query: { limit: '1' },
        body: undefined,
      },
    ]);
  });
});

describe('TimeEntry', () => {
  test('a start and end travel as RFC 3339 instants', async () => {
    const requests = serve(() =>
      Response.json({ entry: entry(), totalMinutes: 60 }),
    );
    await macro()
      .tasks.byId(taskId)
      .logTime({
        minutes: 60,
        date: '2026-11-20',
        startedAt: new Date('2026-11-20T09:00:00Z'),
        endedAt: new Date('2026-11-20T10:00:00Z'),
      });

    expect(requests[0]?.body).toEqual({
      date: '2026-11-20',
      minutes: 60,
      startedAt: '2026-11-20T09:00:00.000Z',
      endedAt: '2026-11-20T10:00:00.000Z',
    });
  });

  test('null for one end of the span clears both, which the server needs', async () => {
    const requests = serve(() =>
      Response.json({ entry: entry(), totalMinutes: 90 }),
    );
    const found = TimeEntry.byId(macro()._client, entryId);

    await found.edit({ startedAt: null });
    await found.edit({ endedAt: null });
    await found.edit({
      startedAt: new Date('2026-11-20T09:00:00Z'),
      endedAt: new Date('2026-11-20T10:30:00Z'),
    });

    expect(requests.map((request) => request.body)).toEqual([
      { startedAt: null, endedAt: null },
      { startedAt: null, endedAt: null },
      {
        startedAt: '2026-11-20T09:00:00.000Z',
        endedAt: '2026-11-20T10:30:00.000Z',
      },
    ]);
  });

  test('edit, startTimer and stop refuse options they do not take', async () => {
    const requests = serve(() => Response.json({}));
    const client = macro()._client;

    await expect(
      TimeEntry.byId(client, entryId).edit({ user: 'someone' } as never),
    ).rejects.toThrow('timeEntry.edit does not take `user`');
    await expect(
      macro()
        .tasks.byId(taskId)
        .startTimer({ startedAt: new Date() } as never),
    ).rejects.toThrow('task.startTimer does not take `startedAt`');
    await expect(
      Timer.byId(client, timerId).stop({ minutes: 5 } as never),
    ).rejects.toThrow('timer.stop does not take `minutes`');
    expect(requests).toHaveLength(0);
  });

  test('edit sends only the changed fields and keeps the stored entry', async () => {
    const requests = serve(() =>
      Response.json({
        entry: entry({ minutes: 45, note: null }),
        totalMinutes: 45,
      }),
    );
    const found = TimeEntry.byId(macro()._client, entryId);

    await found.edit({ minutes: 45, note: null });

    expect(requests).toEqual([
      {
        method: 'PATCH',
        path: `/time/entries/${entryId}`,
        query: {},
        body: { minutes: 45, note: null },
      },
    ]);
    expect(await found.minutes()).toBe(45);
    expect(await found.note()).toBeUndefined();
    expect(requests).toHaveLength(1);
  });

  test("someone else's entry is refused as not the author, not as missing access", async () => {
    serve(() =>
      Response.json(
        {
          code: 'not_author',
          message: 'only the person who logged this entry can change it',
        },
        { status: 403 },
      ),
    );
    const found = TimeEntry.byId(macro()._client, entryId);

    await expect(found.edit({ minutes: 10 })).rejects.toBeInstanceOf(
      NotTimeEntryAuthorError,
    );
    await expect(found.remove()).rejects.toBeInstanceOf(
      NotTimeEntryAuthorError,
    );
    await expect(found.remove()).rejects.not.toBeInstanceOf(
      MacroForbiddenError,
    );
  });

  test('remove deletes the entry', async () => {
    const requests = serve(() => Response.json({ totalMinutes: 0 }));

    await TimeEntry.byId(macro()._client, entryId).remove();

    expect(requests).toEqual([
      {
        method: 'DELETE',
        path: `/time/entries/${entryId}`,
        query: {},
        body: undefined,
      },
    ]);
  });

  test('a handle made by id has no fields to read', async () => {
    serve(() => Response.json({}));
    await expect(
      TimeEntry.byId(macro()._client, entryId).minutes(),
    ).rejects.toThrow('task.timeEntries()');
  });
});

describe('timer', () => {
  test('macro.time.timer() is undefined when nothing runs', async () => {
    serve(() =>
      Response.json({ timer: null, serverNow: '2026-11-23T09:00:00Z' }),
    );
    expect(await macro().time.timer()).toBeUndefined();
  });

  test('startTimer returns the new timer and the entry saved for the one it stopped', async () => {
    const requests = serve(() =>
      Response.json({
        timer: runningTimer(timerId, otherTaskId),
        stopped: {
          entry: entry({ id: olderEntryId, source: 'timer' }),
          totalMinutes: 90,
        },
      }),
    );

    const { timer, stopped } = await macro()
      .tasks.byId(otherTaskId)
      .startTimer({ timeZone: 'Europe/Paris' });

    expect(requests[0]).toEqual({
      method: 'POST',
      path: '/time/timer/start',
      query: {},
      body: { taskId: otherTaskId, timeZone: 'Europe/Paris' },
    });
    expect(timer.id).toBe(timerId);
    expect((await timer.task()).id).toBe(otherTaskId);
    expect(stopped?.id).toBe(olderEntryId);
    expect(await stopped?.source()).toBe('timer');
  });

  test('stop saves the entry; a discarded timer stops with nothing', async () => {
    const requests = serve(({ path }) =>
      path === '/time/timer'
        ? Response.json({
            timer: runningTimer(),
            serverNow: '2026-11-23T09:00:00Z',
          })
        : Response.json({ logged: null }),
    );
    const timer = await macro().time.timer();

    expect(await timer?.stop({ timeZone: 'Europe/Paris' })).toBeUndefined();
    expect(requests[1]).toEqual({
      method: 'POST',
      path: '/time/timer/stop',
      query: {},
      body: { timerId, timeZone: 'Europe/Paris' },
    });
  });

  test('a timer past the limit is refused with the timer to resolve, then stopped at a stated end', async () => {
    const endedAt = new Date('2026-11-23T12:00:00Z');
    const requests = serve(({ body }) =>
      (body as { endedAt?: string }).endedAt
        ? Response.json({
            logged: {
              entry: entry({ id: timerId, minutes: 240, source: 'timer' }),
              totalMinutes: 240,
            },
          })
        : Response.json(
            {
              code: 'timer_over_limit',
              message: 'the timer ran over 8 hours',
              timer: runningTimer(),
            },
            { status: 409 },
          ),
    );

    const refusal = await macro()
      .tasks.byId(otherTaskId)
      .startTimer()
      .catch((error: unknown) => error);

    expect(refusal).toBeInstanceOf(TimerOverLimitError);
    const overLimit = (refusal as TimerOverLimitError).timer;
    expect(overLimit?.id).toBe(timerId);
    expect((await overLimit?.task())?.id).toBe(taskId);

    const saved = await overLimit?.stop({ endedAt });
    expect(await saved?.minutes()).toBe(240);
    expect(requests[1]?.body).toEqual({
      timerId,
      endedAt: endedAt.toISOString(),
    });
  });

  test('stopping a timer past the limit throws without saving, then logs all of it', async () => {
    const requests = serve(({ body }) =>
      (body as { logAll?: boolean }).logAll
        ? Response.json({
            logged: {
              entry: entry({ id: timerId, minutes: 540, source: 'timer' }),
              totalMinutes: 540,
            },
          })
        : Response.json(
            {
              code: 'timer_over_limit',
              message: 'the timer ran over 8 hours',
              timer: runningTimer(),
            },
            { status: 409 },
          ),
    );
    const timer = Timer.byId(macro()._client, timerId);

    const refusal = await timer.stop().catch((error: unknown) => error);
    expect(refusal).toBeInstanceOf(TimerOverLimitError);
    expect((refusal as TimerOverLimitError).timer?.id).toBe(timerId);

    const saved = await timer.stop({ logAll: true });
    expect(await saved?.minutes()).toBe(540);
    expect(requests.map((request) => request.body)).toEqual([
      { timerId },
      { timerId, logAll: true },
    ]);
  });

  test('an over-limit refusal without its timer is still a TimerOverLimitError', async () => {
    serve(() =>
      Response.json(
        { code: 'timer_over_limit', message: 'the timer ran over 8 hours' },
        { status: 409 },
      ),
    );

    const refusal = await Timer.byId(macro()._client, timerId)
      .stop()
      .catch((error: unknown) => error);

    expect(refusal).toBeInstanceOf(TimerOverLimitError);
    expect((refusal as TimerOverLimitError).timer).toBeUndefined();
  });

  test('discard drops the timer', async () => {
    const requests = serve(() => new Response(null, { status: 204 }));
    await Timer.byId(macro()._client, timerId).discard();

    expect(requests).toEqual([
      {
        method: 'POST',
        path: '/time/timer/discard',
        query: {},
        body: { timerId },
      },
    ]);
  });
});

const projectId = '01a1fa5b-0000-7000-8000-0000000000b1';

function summaryRecord(overrides: Record<string, unknown> = {}) {
  return {
    from: '2026-11-23',
    to: '2026-11-29',
    totalMinutes: 150,
    taskCount: 2,
    scopeTaskCount: null,
    complete: true,
    groups: [
      {
        key: { by: 'task', taskId },
        minutes: 90,
        taskCount: 1,
        rows: [{ key: { by: 'day', date: '2026-11-24' }, minutes: 90 }],
      },
      {
        key: { by: 'person', userId },
        minutes: 60,
        taskCount: 1,
        rows: [],
      },
    ],
    thenTotals: [{ key: { by: 'day', date: '2026-11-24' }, minutes: 90 }],
    ...overrides,
  };
}

describe('time summaries', () => {
  test('macro.time.summary reads your week and returns handles for people and tasks', async () => {
    const requests = serve(() => Response.json(summaryRecord()));

    const week = await macro().time.summary({
      scope: 'mine',
      from: '2026-11-23',
      to: '2026-11-29',
      groupBy: 'task',
      thenBy: 'day',
    });

    expect(requests).toEqual([
      {
        method: 'GET',
        path: '/time/summary',
        query: {
          scope: 'mine',
          from: '2026-11-23',
          to: '2026-11-29',
          groupBy: 'task',
          thenBy: 'day',
        },
        body: undefined,
      },
    ]);
    expect(week.totalMinutes).toBe(150);
    expect(week.projectTaskCount).toBeUndefined();
    const [first, second] = week.groups;
    expect(first.key.by === 'task' && first.key.task.id).toBe(taskId);
    expect(first.rows).toEqual([
      { key: { by: 'day', date: '2026-11-24' }, minutes: 90 },
    ]);
    expect(second.key.by === 'person' && second.key.person.id).toBe(userId);
    expect(week.thenTotals[0].minutes).toBe(90);
  });

  test("initiative.timeSummary reads the project's time by its handle", async () => {
    const requests = serve(() =>
      Response.json(summaryRecord({ scopeTaskCount: 14, complete: false })),
    );

    const month = await macro()
      .initiatives.byId(projectId)
      .timeSummary({ from: '2026-11-01', to: '2026-11-30', groupBy: 'person' });

    expect(requests[0].query).toEqual({
      scope: 'project',
      projectId,
      from: '2026-11-01',
      to: '2026-11-30',
      groupBy: 'person',
    });
    expect(month.projectTaskCount).toBe(14);
    expect(month.complete).toBe(false);
  });

  test('exports return the CSV text and say whether it is complete', async () => {
    const requests = serve(() =>
      Response.json({ csv: 'Date,Person\n', rows: 0, complete: true }),
    );

    const team = await macro().time.exportCsv({
      scope: 'team',
      from: '2026-11-01',
      to: '2026-11-30',
    });
    const project = await macro()
      .initiatives.byId(projectId)
      .exportTimeCsv({ from: '2026-11-01', to: '2026-11-30' });

    expect(team).toEqual({ csv: 'Date,Person\n', rows: 0, complete: true });
    expect(project.complete).toBe(true);
    expect(requests.map((seen) => [seen.path, seen.query])).toEqual([
      ['/time/export', { scope: 'team', from: '2026-11-01', to: '2026-11-30' }],
      [
        '/time/export',
        { scope: 'project', projectId, from: '2026-11-01', to: '2026-11-30' },
      ],
    ]);
  });

  test('refuses a bad scope, day, grouping or option before any request', async () => {
    const requests = serve(() => Response.json(summaryRecord()));
    const time = macro().time;
    const week = { from: '2026-11-23', to: '2026-11-29' };

    for (const call of [
      () =>
        time.summary({
          ...week,
          scope: 'project' as 'mine',
          groupBy: 'task',
        }),
      () => time.summary({ ...week, scope: 'mine', groupBy: 'week' as 'day' }),
      () =>
        time.summary({
          ...week,
          scope: 'mine',
          groupBy: 'day',
          thenBy: 'hour' as 'task',
        }),
      () =>
        time.summary({
          from: '2026-02-30',
          to: '2026-11-29',
          scope: 'mine',
          groupBy: 'day',
        }),
      () =>
        time.exportCsv({
          ...week,
          scope: 'team',
          format: 'xlsx',
        } as Parameters<typeof time.exportCsv>[0]),
      () =>
        macro()
          .initiatives.byId(projectId)
          .timeSummary({
            ...week,
            groupBy: 'task',
            scope: 'team',
          } as Parameters<typeof time.summary>[0]),
    ])
      await expect(call()).rejects.toBeInstanceOf(MacroError);
    expect(requests).toEqual([]);
  });
});
