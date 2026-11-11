import { expect, test } from 'bun:test';
import type { Woke } from '@macro-inc/muppet/core/agent';
import { fixedClock } from '../../../context/test/fakes.ts';
import {
  type Beat,
  beat,
  type Cursor,
  mentionedIds,
  snapshotDiff,
  snapshotHash,
  syncMessage,
  tickPrompt,
  wakeReason,
} from '../tick.ts';

const digest = (text: string): string =>
  new Bun.CryptoHasher('sha256').update(text).digest('hex');
const facts = { hash: 'a', lastHash: 'a', snapshot: '## Section\n- x' };

test('hash matches `sha256sum <<<"$snap" | cut -c1-16`', () => {
  expect(snapshotHash(digest, 'hello\nworld')).toBe('4a1e67f2fe1d1cc7');
});

test('only a change to something wakes', () => {
  expect(wakeReason(facts)).toBeUndefined();
  expect(wakeReason({ ...facts, hash: 'b' })).toBe('snapshot changed');
  expect(wakeReason({ ...facts, lastHash: undefined })).toBe(
    'snapshot changed'
  );
  // Gone empty: what was there is settled.
  expect(wakeReason({ ...facts, hash: 'b', snapshot: '' })).toBeUndefined();
  expect(
    wakeReason({ ...facts, lastHash: undefined, snapshot: ' \n' })
  ).toBeUndefined();
});

test('the diff shows what left and what came, in order, and nothing when nothing changed', () => {
  expect(snapshotDiff('a', 'a')).toBe('');
  expect(snapshotDiff('a', 'b')).toBe('< a\n> b');
  expect(
    snapshotDiff('h\n- #1 open\n- #2 open\nt', 'h\n- #2 open\n- #3 open\nt')
  ).toBe('< - #1 open\n> - #3 open');
  expect(snapshotDiff('', 'a\nb')).toBe('< \n> a\n> b');
});

test('the prompt: the request, the people, why, the snapshot, the diff', () => {
  expect(
    tickPrompt({
      request: 'TICK\n\n',
      people: '',
      reason: 'r',
      snapshot: 'S',
      diff: '< a\n> S',
    })
  ).toBe(
    'TICK\n## Why you woke: r\n## Snapshot now\nS\n## Diff from last snapshot\n< a\n> S'
  );
  expect(
    tickPrompt({
      request: 'TICK',
      people: '## The people here\ncard\n',
      reason: 'r',
      snapshot: 'S',
      diff: '',
    })
  ).toStartWith('TICK\n## The people here\ncard\n## Why you woke: r\n');
});

test('the ids a snapshot names, the owner first', () => {
  const owner = 'macro|owner@example.com';
  expect(
    mentionedIds(
      `x macro|a.b@example.com y ${owner} z macro|a.b@example.com`,
      owner
    )
  ).toEqual([owner, 'macro|a.b@example.com']);
});

/** A tick with everything faked, and a record of what it did. */
const tick = (
  over: Partial<Beat> = {},
  state: { cursor?: Cursor; last?: string } = {}
) => {
  const clock = fixedClock('2026-11-03T10:00:00Z');
  const done: string[] = [];
  const logged: object[] = [];
  const prompts: string[] = [];
  const deps: Beat = {
    now: clock.now,
    digest,
    commit: async (message) => {
      done.push(`commit ${message}`);
    },
    guard: async () => {
      done.push('guard');
    },
    collect: async () => '## Section\n- do it\n',
    cursor: {
      read: async () => state.cursor,
      write: async (cursor) => {
        state.cursor = cursor;
      },
    },
    last: {
      read: async () => state.last,
      write: async (text) => {
        state.last = text;
      },
    },
    prune: async () => {
      done.push('prune');
    },
    people: async () => '',
    request: 'TICK',
    wake: async (prompt): Promise<Woke> => {
      prompts.push(prompt);
      return { kind: 'done', reply: 'ok' };
    },
    log: async (entry) => {
      logged.push(entry);
    },
    ...over,
  };
  return { deps, state, done, logged, prompts, clock };
};

const quiet = (snapshot: string): Cursor => ({
  hash: snapshotHash(digest, snapshot),
  lastRun: '2026-11-03T09:00:00Z',
});

test('a tick that wakes prunes, wakes the agent with the prompt, and records the tick', async () => {
  const { deps, state, done, logged, prompts } = tick();
  const beaten = await beat(deps);
  expect(beaten.kind).toBe('woke');
  if (beaten.kind !== 'woke') return;
  expect(beaten.reason).toBe('snapshot changed');
  expect(await beaten.finished).toEqual({ kind: 'done', reply: 'ok' });
  expect(prompts[0]).toStartWith(
    'TICK\n## Why you woke: snapshot changed\n## Snapshot now\n## Section\n- do it\n'
  );
  expect(done).toEqual([`commit ${syncMessage}`, 'guard', 'prune']);
  expect(state.cursor).toEqual({
    hash: snapshotHash(digest, '## Section\n- do it'),
    lastRun: '2026-11-03T10:00:00Z',
  });
  expect(state.last).toBe('## Section\n- do it\n');
  expect(logged).toEqual([
    { woke: true, reason: 'snapshot changed', result: 'ok' },
  ]);
});

test('a quiet tick commits, checks main and prunes, and wakes nobody', async () => {
  const { deps, done, logged, prompts, state } = tick(
    { collect: async () => 'S' },
    { cursor: quiet('S') }
  );
  expect(await beat(deps)).toEqual({ kind: 'asleep' });
  expect(prompts).toEqual([]);
  expect(done).toEqual([`commit ${syncMessage}`, 'guard', 'prune']);
  expect(logged).toEqual([{ woke: false }]);
  expect(state.cursor).toEqual(quiet('S'));
});

test('a snapshot gone empty wakes nobody, and the same thing coming back wakes again', async () => {
  const settled = tick(
    { collect: async () => '' },
    { cursor: quiet('S'), last: 'S\n' }
  );
  expect(await beat(settled.deps)).toEqual({ kind: 'asleep' });
  expect(settled.prompts).toEqual([]);
  expect(settled.state).toEqual({
    cursor: { hash: snapshotHash(digest, ''), lastRun: '2026-11-03T09:00:00Z' },
    last: '',
  });

  const back = tick({ collect: async () => 'S' }, settled.state);
  const beaten = await beat(back.deps);
  if (beaten.kind !== 'woke') throw new Error('should have woken');
  await beaten.finished;
  expect(back.prompts[0]).toEndWith('## Diff from last snapshot\n< \n> S');
});

test('an empty snapshot on a first tick wakes nobody', async () => {
  const { deps, prompts } = tick({ collect: async () => '' });
  expect(await beat(deps)).toEqual({ kind: 'asleep' });
  expect(prompts).toEqual([]);
});

test("a failed run is logged as failed, and still recorded so it isn't retried every tick", async () => {
  const { deps, logged, state } = tick({
    collect: async () => 'S',
    wake: async () => ({ kind: 'failed', error: 'timed out' }),
  });
  const beaten = await beat(deps);
  if (beaten.kind !== 'woke') throw new Error('should have woken');
  await beaten.finished;
  expect(logged).toEqual([
    {
      woke: true,
      reason: 'snapshot changed',
      result: 'failed',
      error: 'timed out',
    },
  ]);
  expect(state.cursor?.hash).toBe(snapshotHash(digest, 'S'));
});

test('the sync commit, the main check and the prune failing stop nothing', async () => {
  const boom = async () => {
    throw new Error('down');
  };
  const { deps, logged, prompts } = tick({
    commit: boom,
    guard: boom,
    prune: boom,
    people: boom,
  });
  const beaten = await beat(deps);
  if (beaten.kind !== 'woke') throw new Error('should have woken');
  await beaten.finished;
  expect(prompts).toHaveLength(1);
  expect(logged.slice(0, 3)).toEqual([
    { failed: 'sync commit', error: 'Error: down' },
    { failed: 'main check', error: 'Error: down' },
    { failed: 'prune', error: 'Error: down' },
  ]);
});

test('the tick returns as soon as the agent is woken; the record waits for its run', async () => {
  let end: (woke: Woke) => void = () => undefined;
  const { deps, state } = tick({
    wake: () =>
      new Promise<Woke>((resolve) => {
        end = resolve;
      }),
  });
  const beaten = await beat(deps);
  if (beaten.kind !== 'woke') throw new Error('should have woken');
  expect(state.cursor).toBeUndefined();
  end({ kind: 'done', reply: '' });
  await beaten.finished;
  expect(state.cursor).toBeDefined();
});

test('the diff in the prompt is against the last snapshot the agent woke on', async () => {
  const { deps, prompts } = tick(
    { collect: async () => 'h\nnew' },
    { cursor: quiet('h\nold'), last: 'h\nold\n' }
  );
  await beat(deps);
  expect(prompts[0]).toEndWith('## Diff from last snapshot\n< old\n> new');
});
