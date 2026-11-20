import { describe, expect, test } from 'bun:test';
import { UNJUDGED, judgeWaiting } from './judging';

type Attempt = { id: string; benchError?: string; score?: number };

/** A judgement that finishes when the test says so. */
function held() {
  let finish = () => {};
  const done = new Promise<void>((resolve) => {
    finish = resolve;
  });
  return { done, finish };
}

describe('judgeWaiting', () => {
  test('a save while another attempt is judged still marks that one not judged', async () => {
    const first: Attempt = { id: 'a1', benchError: UNJUDGED };
    const second: Attempt = { id: 'a2', benchError: UNJUDGED };
    const slow = held();
    const saves: Attempt[][] = [];
    const judging = judgeWaiting(
      [
        { slot: { name: 'founder' }, attempt: first, log: () => {} },
        { slot: { name: 'founder' }, attempt: second, log: () => {} },
      ],
      async (_, attempt) => {
        if (attempt === second) await slow.done;
        attempt.score = 80;
      },
      () => saves.push(structuredClone([first, second])),
    );
    await judging[0];
    expect(saves).toEqual([[{ id: 'a1', score: 80 }, { id: 'a2', benchError: UNJUDGED }]]);
    slow.finish();
    await Promise.all(judging);
    expect(saves[1]).toEqual([{ id: 'a1', score: 80 }, { id: 'a2', score: 80 }]);
  });

  test('a failed judgement keeps its own error', async () => {
    const attempt: Attempt = { id: 'a1', benchError: UNJUDGED };
    await Promise.all(
      judgeWaiting(
        [{ slot: { name: 'founder' }, attempt, log: () => {} }],
        async (_, a) => {
          a.benchError = 'judge: timed out';
        },
        () => {},
      ),
    );
    expect(attempt.benchError).toBe('judge: timed out');
  });

  test("each persona's first attempt is judged before any second one", async () => {
    const started: string[] = [];
    const waiting = [
      ['founder', 'f1'],
      ['founder', 'f2'],
      ['sales', 's1'],
      ['founder', 'f3'],
      ['sales', 's2'],
    ].map(([name, id]) => ({ slot: { name }, attempt: { id, benchError: UNJUDGED } as Attempt, log: () => {} }));
    await Promise.all(
      judgeWaiting(
        waiting,
        async (_, attempt) => {
          started.push(attempt.id);
        },
        () => {},
      ),
    );
    expect(started).toEqual(['f1', 's1', 'f2', 'f3', 's2']);
  });
});
