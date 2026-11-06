import assert from 'node:assert/strict';
import { test } from 'node:test';
import { askContent, rules, sentences } from './brain.ts';

test('streams sentences without splitting a model version or quoted punctuation', () => {
  assert.deepStrictEqual(sentences('Checking. One sec'), [
    ['Checking.'],
    ' One sec',
  ]);
  assert.deepStrictEqual(sentences('Version 5.5 is'), [[], 'Version 5.5 is']);
  assert.deepStrictEqual(sentences('He said "no." Then'), [
    ['He said "no."'],
    ' Then',
  ]);
  assert(rules().includes('hand_off'));
  assert(
    askContent({
      who: 'caller',
      name: 'Caller',
      text: 'What now?',
      context: ['Other: hi'],
      cutOff: true,
    }).includes('Caller [caller] says to you: What now?')
  );
});

test('SDK process failure rejects warm-up and every later queued turn', async () => {
  const { claudeBrain } = await import('./brain.ts');
  const brain = claudeBrain({
    callId: 'call',
    channel: 'channel',
    operating: 'Agent',
    options: {},
    emit() {},
    onHangUp() {},
    async handOff() {
      return 'task';
    },
    async briefing() {
      return 'Briefing';
    },
    session() {
      return {
        [Symbol.asyncIterator]() {
          return {
            async next() {
              throw new Error('SDK process exited');
            },
          };
        },
        async interrupt() {},
        close() {},
      };
    },
  });
  await assert.rejects(brain.start(), /SDK process exited/);
  const ask = async (turn: number) => {
    for await (const _ of brain.ask(turn, 'Question?')) {
    }
  };
  await Promise.all([
    assert.rejects(ask(1), /SDK process exited/),
    assert.rejects(ask(2), /SDK process exited/),
  ]);
  await brain.close();
});

test('persistent call sessions account only new SDK spend, including zeroed error results', async () => {
  const { claudeBrain } = await import('./brain.ts');
  const costs: unknown[] = [];
  const brain = claudeBrain({
    callId: 'call',
    channel: 'channel',
    operating: 'Agent',
    options: {},
    emit(type, data) {
      if (type === 'brain.result') costs.push(data?.cost);
    },
    onHangUp() {},
    async handOff() {
      return 'task';
    },
    async briefing() {
      return 'Briefing';
    },
    session(prompt) {
      return {
        async *[Symbol.asyncIterator]() {
          const totals = [0.125, 0.25, 0, 0.375];
          let turn = 0;
          for await (const _ of prompt) {
            const total = totals[turn++]!;
            yield {
              type: 'result',
              subtype: total === 0 ? 'error_during_execution' : 'success',
              duration_ms: 1,
              total_cost_usd: total,
            };
          }
        },
        async interrupt() {},
        close() {},
      };
    },
  });
  try {
    await brain.start();
    for (const turn of [1, 2, 3])
      await Array.fromAsync(brain.ask(turn, 'Question?'));
    assert.deepEqual(costs, [0.125, 0.125, 0, 0.125]);
  } finally {
    await brain.close();
  }
});
