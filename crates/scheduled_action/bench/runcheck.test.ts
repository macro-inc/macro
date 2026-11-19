import { afterEach, expect, mock, spyOn, test } from 'bun:test';
import type { SQL } from 'bun';

import type { Case } from './cases';
import { type SavedRoutine, runCheck } from './runcheck';
import type { Stack } from './stack';
import { OWNER } from './workspace';

const stack = { harness: 'https://harness.example.com' } as Stack;
const tokens = { [OWNER]: 'test-token' };
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
const item: Case = {
  id: 'example',
  text: 'Remind me about tasks',
  kind: 'routine',
  code: true,
  expect: [],
  run: {
    says: 'the routine ran',
    fire: () => ({ type: 'execute' }),
    holds: (effects) => effects.runs.some((run) => run.isSuccess),
  },
};
const copy = (id: string) => ({ ...parent, id, task: { sub_routine: 'remind' } });
const copyCase = { ...item, run: { ...item.run!, runCopies: true } };

function fixture(children: SavedRoutine[], { failReply = false, earlierRun = false } = {}) {
  const db = (async (parts: TemplateStringsArray, ...args: unknown[]) => {
    if (parts.join('').includes('from agent_session_log')) {
      if (failReply && args[0] === 'failed-copy') throw new Error('reply read failed');
      return [{ text: 'Reminder' }];
    }
    return [];
  }) as unknown as SQL;
  const sleep = spyOn(Bun, 'sleep').mockResolvedValue(undefined);
  let copyReads = 0;
  const fetch = spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
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
      runCheck(stack, db, tokens, testCase, { outcome: 'routine' }, parent, {
        ids: {},
        now: new Date(),
        timezone: 'UTC',
        made: [],
      }),
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
