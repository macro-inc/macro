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

function fixture(children: SavedRoutine[], failReply = false) {
  const db = (async (parts: TemplateStringsArray, ...args: unknown[]) => {
    if (parts.join('').includes('from agent_session_log')) {
      if (failReply && args[0] === 'failed-copy') throw new Error('reply read failed');
      return [{ text: 'Reminder' }];
    }
    return [];
  }) as unknown as SQL;
  spyOn(Bun, 'sleep').mockResolvedValue(undefined);
  const fetch = spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = new URL(String(input));
    if (url.searchParams.has('parent')) return Response.json(children);
    if (url.pathname.endsWith('/history')) {
      const id = url.pathname.split('/').at(-2);
      return Response.json([{
        start_time: new Date().toISOString(),
        is_success: true,
        result: id === 'parent' ? {} : { resource: { type: 'agent', id } },
      }]);
    }
    if (init?.method === 'POST' || init?.method === 'DELETE') return new Response(null);
    throw new Error(`unexpected request: ${url}`);
  });
  return {
    fetch,
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
  const check = fixture([copy('failed-copy'), copy('other-copy')], true);
  const result = await check.run();
  expect(result?.effects.copies?.map((copy) => copy.runs?.map((run) => run.reply))).toEqual([
    [],
    ['Reminder'],
  ]);
});
