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
    anthropic: () => ({
      baseUrl: 'http://127.0.0.1',
      token: 'query-token',
      revoke() {},
    }),
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
    anthropic: () => ({
      baseUrl: 'http://127.0.0.1',
      token: 'query-token',
      revoke() {},
    }),
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

test('voice keeps one same-key-safe relay capability for its SDK query and revokes it on close', async (t) => {
  const { anthropicRelay } = await import('../anthropic-relay.ts');
  const { claudeBrain } = await import('./brain.ts');
  const relay = await anthropicRelay(
    'http://127.0.0.1:1/anthropic',
    'same-enrollment-key'
  );
  t.after(() => relay.close());
  let child: import('@anthropic-ai/claude-agent-sdk').Options | undefined;
  let leases = 0;
  const brain = claudeBrain({
    callId: 'call',
    channel: 'channel',
    operating: 'Agent',
    options: {
      env: {
        MACRO_API_KEY: 'same-enrollment-key',
        ANTHROPIC_AUTH_TOKEN: 'same-enrollment-key',
      },
    },
    anthropic(signal) {
      leases++;
      return relay.access(signal);
    },
    emit() {},
    onHangUp() {},
    async handOff() {
      return 'task';
    },
    async briefing() {
      return 'Briefing';
    },
    session(prompt, options) {
      child = options;
      return {
        async *[Symbol.asyncIterator]() {
          for await (const _ of prompt)
            yield {
              type: 'result',
              subtype: 'success',
              duration_ms: 1,
              total_cost_usd: 0.125,
            };
        },
        async interrupt() {},
        close() {},
      };
    },
  });
  t.after(() => brain.close());
  await brain.start();
  await Array.fromAsync(brain.ask(1, 'Question?'));
  await Array.fromAsync(brain.ask(2, 'Another?'));
  assert.equal(leases, 1);
  assert.equal(
    JSON.stringify(child?.env).includes('same-enrollment-key'),
    false
  );
  assert(child?.env?.ANTHROPIC_BASE_URL);
  assert(child.env.ANTHROPIC_AUTH_TOKEN);
  assert.equal(child.env.MACRO_API_KEY, undefined);
  const endpoint = `${child.env.ANTHROPIC_BASE_URL}/v1/messages`;
  const headers = { authorization: `Bearer ${child.env.ANTHROPIC_AUTH_TOKEN}` };
  assert.equal(
    (await fetch(endpoint, { method: 'POST', headers })).status,
    502
  );
  await brain.close();
  assert.equal(
    (await fetch(endpoint, { method: 'POST', headers })).status,
    401
  );
});

test('voice startup failure revokes its capability and cannot leave a query credential active', async (t) => {
  const { anthropicRelay } = await import('../anthropic-relay.ts');
  const { claudeBrain } = await import('./brain.ts');
  const relay = await anthropicRelay(
    'http://127.0.0.1:1/anthropic',
    'same-enrollment-key'
  );
  t.after(() => relay.close());
  let child: import('@anthropic-ai/claude-agent-sdk').Options | undefined;
  const brain = claudeBrain({
    callId: 'call',
    channel: 'channel',
    operating: 'Agent',
    options: {},
    anthropic: relay.access,
    emit() {},
    onHangUp() {},
    async handOff() {
      return 'task';
    },
    async briefing() {
      return 'Briefing';
    },
    session(_prompt, options) {
      child = options;
      throw new Error('fixture startup failure');
    },
  });
  await assert.rejects(brain.start(), /fixture startup failure/);
  assert(child?.env?.ANTHROPIC_BASE_URL);
  assert.equal(
    (
      await fetch(`${child.env.ANTHROPIC_BASE_URL}/v1/messages`, {
        method: 'POST',
        headers: { authorization: `Bearer ${child.env.ANTHROPIC_AUTH_TOKEN}` },
      })
    ).status,
    401
  );
});

test('a failed relay lease rejects voice startup and later queued asks', async () => {
  const { claudeBrain } = await import('./brain.ts');
  const brain = claudeBrain({
    callId: 'call',
    channel: 'channel',
    operating: 'Agent',
    options: {},
    anthropic() {
      throw new Error('relay stopped');
    },
    emit() {},
    onHangUp() {},
    async handOff() {
      return 'task';
    },
    async briefing() {
      return 'Briefing';
    },
    session() {
      throw new Error('must not start SDK');
    },
  });
  await assert.rejects(brain.start(), /relay stopped/);
  await assert.rejects(
    Array.fromAsync(brain.ask(1, 'Question?')),
    /relay stopped/
  );
});
