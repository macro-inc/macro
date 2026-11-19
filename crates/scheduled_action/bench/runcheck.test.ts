import { afterEach, expect, mock, spyOn, test } from 'bun:test';
import type { SQL } from 'bun';

import type { Case, RunCheck } from './cases';
import { type SavedRoutine, runCheck } from './runcheck';
import type { Stack } from './stack';
import { sessionSpans } from './trace';
import { OWNER } from './workspace';

const stack = { harness: 'https://harness.example.com', tempo: 'https://tempo.example.com' } as Stack;
const tokens = { [OWNER]: 'test-token' };
const traceparent = '00-0123456789abcdef0123456789abcdef-0123456789abcdef-01';
const trigger = { type: 'once', at: '2027-01-01T00:00:00Z' };
const parent: SavedRoutine = {
  id: 'parent',
  name: 'Reminders',
  kind: 'Agent',
  enabled: false,
  trigger,
  task: { sub_routines: [{ name: 'remind', steps: [{ type: 'agent' }] }] },
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};
const parentRun: RunCheck = {
  says: 'the routine ran',
  fire: () => ({ type: 'execute' }),
  holds: (effects) => effects.runs.some((run) => run.isSuccess),
};
const item: Case = {
  id: 'example',
  text: 'Remind me about tasks',
  kind: 'routine',
  code: true,
  expect: [],
  run: parentRun,
};
const copy = (id: string) => ({ ...parent, id, task: { sub_routine: 'remind' } });
const copyCase: Case = { ...item, run: { ...parentRun, runCopies: true } };

function mockFetch(respond: (...args: Parameters<typeof fetch>) => ReturnType<typeof fetch>) {
  return spyOn(globalThis, 'fetch').mockImplementation(Object.assign(respond, { preconnect: fetch.preconnect }));
}

function fixture(
  children: SavedRoutine[],
  {
    failReply = false,
    earlierRun = false,
    stallReply,
  }: { failReply?: boolean; earlierRun?: boolean; stallReply?: PromiseWithResolvers<void> } = {},
) {
  const db = (async (parts: TemplateStringsArray, ...args: unknown[]) => {
    if (parts.join('').includes('from agent_session_log')) {
      if (failReply && args[0] === 'failed-copy') throw new Error('reply read failed');
      if (stallReply && args[0] === 'stalled-copy') {
        stallReply.resolve();
        return new Promise(() => undefined);
      }
      return [{ text: 'Reminder' }];
    }
    return [];
  }) as unknown as SQL;
  const sleep = spyOn(Bun, 'sleep').mockResolvedValue(undefined);
  let copyReads = 0;
  const fetch = mockFetch(async (input, init) => {
    const url = new URL(String(input));
    if (url.searchParams.has('parent')) return Response.json(children);
    const id = url.pathname.split('/').at(-2);
    if (url.pathname.endsWith('/history')) {
      const record = (resourceId?: string) => ({
        start_time: new Date().toISOString(),
        is_success: true,
        resource_id: resourceId,
        result: resourceId ? { resource: { type: 'agent', id: resourceId } } : {},
      });
      if (earlierRun && id !== 'parent') {
        copyReads++;
        return Response.json(copyReads === 1 ? [record('earlier-run')] : [record(id), record('earlier-run')]);
      }
      return Response.json([record(id === 'parent' ? undefined : id)]);
    }
    if (init?.method === 'POST') return Response.json({ resource: id === 'parent' ? null : { id } });
    if (init?.method === 'DELETE') return new Response(null);
    throw new Error(`unexpected request: ${url}`);
  });
  return {
    fetch,
    sleep,
    run: (testCase: Case = item) =>
      runCheck(
        stack,
        db,
        tokens,
        testCase,
        { outcome: 'routine' },
        parent,
        { ids: {}, now: new Date(), timezone: 'UTC', made: [] },
        traceparent,
      ),
  };
}

afterEach(() => mock.restore());

test('a copy reply read failure leaves the other copy results available', async () => {
  const check = fixture([copy('failed-copy'), copy('other-copy')], { failReply: true });
  const result = await check.run(copyCase);
  expect(result?.effects.copies?.map((copy) => copy.runs?.map((run) => run.reply))).toEqual([
    [],
    ['Reminder'],
  ]);
});

test('a stalled copy reply read ends at the copy deadline', async () => {
  const deadline = new AbortController();
  spyOn(AbortSignal, 'timeout').mockReturnValue(deadline.signal);
  const replyRead = Promise.withResolvers<void>();
  const check = fixture([copy('stalled-copy')], { stallReply: replyRead });
  const result = check.run(copyCase);
  await replyRead.promise;
  deadline.abort();
  expect((await result)?.effects.copies?.[0]?.runs).toEqual([
    { isSuccess: true, result: { resource: { type: 'agent', id: 'stalled-copy' } } },
  ]);
});

test('copy completion waits for the run started by execute', async () => {
  const check = fixture([copy('definition-copy')], { earlierRun: true });
  const result = await check.run(copyCase);
  expect(result?.effects.copies?.[0]?.runs).toEqual([
    { isSuccess: true, result: { resource: { type: 'agent', id: 'definition-copy' } }, reply: 'Reminder' },
  ]);
  expect(check.sleep).toHaveBeenCalledWith(2000);
  const requests = check.fetch.mock.calls.filter(([url]) => String(url).includes('/definition-copy/'));
  expect(requests).toHaveLength(3);
  const signal = requests[0][1]?.signal;
  expect(signal).toBeInstanceOf(AbortSignal);
  expect(requests.every(([, init]) => init?.signal === signal)).toBe(true);
});

test('only cases that check copy behavior execute definition copies', async () => {
  const definitionCopy = copy('definition-copy');
  const ordinaryChild = { ...parent, id: 'ordinary-child', task: { steps: [] } };
  const { fetch, run } = fixture([definitionCopy, ordinaryChild]);
  const executions = () =>
    fetch.mock.calls.flatMap(([url, init]) =>
      init?.method === 'POST' ? [new URL(String(url)).pathname.split('/').at(-2)] : [],
    );
  const parentOnly = await run();
  expect(executions()).toEqual(['parent']);
  expect(parentOnly?.effects.copies?.map((copy) => copy.id)).toEqual(['definition-copy', 'ordinary-child']);

  fetch.mockClear();
  const withCopies = await run(copyCase);
  expect(executions()).toEqual(['parent', 'definition-copy']);
  expect(withCopies?.effects.copies?.map((copy) => copy.runs?.length)).toEqual([1, undefined]);
});

test('the copy list, execute and history requests share the attempt trace', async () => {
  const { fetch, run } = fixture([copy('definition-copy')]);
  await run(copyCase);
  const traced = fetch.mock.calls
    .filter(([url]) => /\?parent=|\/definition-copy\/(execute|history)$/.test(String(url)))
    .map(([, init]) => new Headers(init?.headers).get('traceparent'));
  expect(traced).toEqual([traceparent, traceparent, traceparent]);
});

test('a copy chat on the attempt trace cannot stand in for the drafting chat', async () => {
  spyOn(Bun, 'sleep').mockResolvedValue(undefined);
  const response = (name: string, startMs: number) => Response.json({
    batches: [{ scopeSpans: [{ spans: [{
      name,
      startTimeUnixNano: String(startMs * 1_000_000),
      endTimeUnixNano: String((startMs + 1) * 1_000_000),
      attributes: [{ key: 'gen_ai.operation.name', value: { stringValue: 'chat' } }],
    }] }] }],
  });
  mockFetch(async (input) => {
    const path = new URL(String(input)).pathname;
    if (path === '/api/search') return Response.json({ traces: [{ traceID: 'fallback' }] });
    if (path === '/api/traces/fallback') return response('draft chat', 1_100);
    return response('copy chat', 2_100);
  });

  const spans = await sessionSpans(stack, 'attempt', 'draft-session', { start: 1_000, end: 1_200 });
  expect(spans.map((span) => span.name)).toEqual(['copy chat', 'draft chat']);
});
