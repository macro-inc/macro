import { simulate, step } from '@macro-inc/machine';
import { describe, expect, it } from 'vitest';
import {
  activeTargetMessageId,
  activeTargetMessageReplyId,
  type Command,
  type Event,
  hasPendingElementScroll,
  initialState,
  pendingScrollTargetId,
  pendingTargetReplyId,
  type State,
  type Target,
  targetMessageDef,
} from '../target-message';

const ROOT: Target = { messageId: 'm1', replyId: undefined };
const NESTED: Target = { messageId: 'm1', replyId: 'r1' };
const OTHER: Target = { messageId: 'm2', replyId: undefined };

const idle = (loadAround?: string): State => ({ t: 'idle', loadAround });
const targeting = (target: Target, loadAround?: string): State => ({
  t: 'targeting',
  target,
  loadAround,
});
const flashing = (target: Target, loadAround?: string): State => ({
  t: 'flashing',
  target,
  loadAround,
});

const nav = (target: Target, targetLoaded: boolean, ready = false): Event => ({
  t: 'navigate',
  target,
  targetLoaded,
  ready,
});
const rootDone = (messageId = 'm1'): Event => ({
  t: 'root-scroll-done',
  messageId,
});
const replyDone = (messageId = 'm1', replyId = 'r1'): Event => ({
  t: 'reply-scroll-done',
  messageId,
  replyId,
});
const RESTORED: Event = { t: 'pagination-restored' };
const ELAPSED: Event = { t: 'flash-elapsed' };
const RESET: Event = { t: 'reset' };
const release = (messageId = 'm1'): Event => ({ t: 'release', messageId });

const RESTORE = (loadAround: string): Command => ({
  t: 'restore-default-pagination',
  loadAround,
});

type Expected = { state: State; commands?: Command[] } | undefined;

function check(from: State, event: Event, expected: Expected) {
  const result = step(targetMessageDef, from, event);
  if (expected === undefined) {
    expect(result).toBeUndefined();
    return;
  }
  expect(result?.state).toEqual(expected.state);
  expect(result?.commands ?? []).toEqual(expected.commands ?? []);
}

describe('navigate', () => {
  it.each<[string, State, Event, Expected]>([
    [
      'unloaded target anchors pagination on itself',
      idle(),
      nav(ROOT, false),
      { state: targeting(ROOT, 'm1') },
    ],
    [
      'loaded target keeps the existing anchor (rapid-navigation rule)',
      idle('m0'),
      nav(ROOT, true),
      { state: targeting(ROOT, 'm0') },
    ],
    [
      'loaded target with no anchor leaves it unset',
      idle(),
      nav(ROOT, true),
      { state: targeting(ROOT, undefined) },
    ],
    [
      'same root target while pending dedupes',
      targeting(ROOT),
      nav(ROOT, true),
      undefined,
    ],
    [
      'same root target dedupes even once ready (root row still pending)',
      targeting(ROOT),
      nav(ROOT, true, true),
      undefined,
    ],
    [
      'same nested target before readiness dedupes',
      targeting(NESTED),
      nav(NESTED, true, false),
      undefined,
    ],
    [
      'same nested target after readiness re-navigates (root row no longer pending)',
      targeting(NESTED, 'm1'),
      nav(NESTED, true, true),
      { state: targeting(NESTED, 'm1') },
    ],
    [
      'different reply on the same message is a new target',
      targeting(ROOT),
      nav(NESTED, true),
      { state: targeting(NESTED, undefined) },
    ],
    [
      'navigating during a flash re-targets (timer is disposed by the runner)',
      flashing(ROOT, 'm1'),
      nav(ROOT, true),
      { state: targeting(ROOT, 'm1') },
    ],
    [
      'superseding a pending target re-anchors when the new one is unloaded',
      targeting(ROOT, 'm1'),
      nav(OTHER, false),
      { state: targeting(OTHER, 'm2') },
    ],
  ])('%s', (_name, from, event, expected) => check(from, event, expected));
});

describe('root-scroll-done', () => {
  it.each<[string, State, Event, Expected]>([
    [
      'root-only target → flashing, restoring the anchored window',
      targeting(ROOT, 'm1'),
      rootDone(),
      { state: flashing(ROOT, 'm1'), commands: [RESTORE('m1')] },
    ],
    [
      'root-only target without an anchor → flashing, nothing to restore',
      targeting(ROOT),
      rootDone(),
      { state: flashing(ROOT) },
    ],
    ['wrong row is ignored', targeting(ROOT), rootDone('m9'), undefined],
    [
      'nested target ignores a root ack (its root row is never positioned)',
      targeting(NESTED),
      rootDone(),
      undefined,
    ],
    ['ignored while flashing', flashing(ROOT), rootDone(), undefined],
    ['ignored while idle', idle(), rootDone(), undefined],
  ])('%s', (_name, from, event, expected) => check(from, event, expected));
});

describe('reply-scroll-done', () => {
  it.each<[string, State, Event, Expected]>([
    [
      'nested target → flashing, restoring the anchored window',
      targeting(NESTED, 'm1'),
      replyDone(),
      { state: flashing(NESTED, 'm1'), commands: [RESTORE('m1')] },
    ],
    [
      'wrong reply is ignored',
      targeting(NESTED),
      replyDone('m1', 'r9'),
      undefined,
    ],
    [
      'wrong message is ignored',
      targeting(NESTED),
      replyDone('m9', 'r1'),
      undefined,
    ],
    [
      'root-only target ignores a reply ack',
      targeting(ROOT),
      replyDone(),
      undefined,
    ],
    ['ignored while flashing', flashing(NESTED), replyDone(), undefined],
  ])('%s', (_name, from, event, expected) => check(from, event, expected));
});

describe('pagination-restored', () => {
  it.each<[string, State]>([
    ['idle', idle('m1')],
    ['targeting', targeting(ROOT, 'm1')],
    ['flashing', flashing(ROOT, 'm1')],
  ])(
    'clears the anchor and preserves everything else while %s',
    (_name, from) => {
      check(from, RESTORED, { state: { ...from, loadAround: undefined } });
    }
  );
});

describe('flash-elapsed', () => {
  it('releases the highlight and keeps the pagination anchor', () =>
    check(flashing(ROOT, 'm1'), ELAPSED, { state: idle('m1') }));

  it.each<[string, State]>([
    ['idle', idle()],
    ['targeting', targeting(ROOT)],
  ])('is ignored while %s (no timer exists there)', (_name, from) =>
    check(from, ELAPSED, undefined)
  );
});

describe('release', () => {
  it.each<[string, State, Event, Expected]>([
    [
      'matching targeting → idle, anchor kept',
      targeting(ROOT, 'm1'),
      release(),
      { state: idle('m1') },
    ],
    [
      'matching flashing → idle',
      flashing(ROOT, 'm1'),
      release(),
      { state: idle('m1') },
    ],
    ['non-matching is ignored', flashing(ROOT), release('m9'), undefined],
    ['idle is ignored', idle('m1'), release(), undefined],
  ])('%s', (_name, from, event, expected) => check(from, event, expected));
});

describe('reset', () => {
  it.each<[string, State]>([
    ['idle', idle('m1')],
    ['targeting', targeting(NESTED, 'm1')],
    ['flashing', flashing(ROOT, 'm1')],
  ])('clears everything including the anchor from %s', (_name, from) =>
    check(from, RESET, { state: idle() })
  );
});

describe('selectors — the ChannelThread contract', () => {
  const channelThreadProps = (s: State, ready: boolean) => {
    const scroll = pendingScrollTargetId(s, ready);
    const reply = pendingTargetReplyId(s);
    return {
      targetMessageId: reply === undefined ? scroll : undefined,
      targetReplyId: scroll === undefined ? reply : undefined,
    };
  };

  it.each<
    [
      string,
      State,
      boolean,
      {
        scroll?: string;
        reply?: string;
        message?: string;
        replyProp?: string;
        any: boolean;
      },
    ]
  >([
    ['idle: nothing', idle(), true, { any: false }],
    [
      'root, not ready: ChannelThread positions the row',
      targeting(ROOT),
      false,
      { scroll: 'm1', message: 'm1', any: true },
    ],
    [
      'root, ready: still positions the row (readiness does not clear a root target)',
      targeting(ROOT),
      true,
      { scroll: 'm1', message: 'm1', any: true },
    ],
    [
      'nested, not ready: both set, so ChannelThread stays idle',
      targeting(NESTED),
      false,
      { scroll: 'm1', reply: 'r1', any: true },
    ],
    [
      'nested, ready: root cleared, reply scroll begins',
      targeting(NESTED),
      true,
      { reply: 'r1', replyProp: 'r1', any: true },
    ],
    ['flashing: nothing pending', flashing(NESTED), true, { any: false }],
  ])('%s', (_name, s, ready, expected) => {
    expect(pendingScrollTargetId(s, ready)).toBe(expected.scroll);
    expect(pendingTargetReplyId(s)).toBe(expected.reply);
    expect(hasPendingElementScroll(s, ready)).toBe(expected.any);
    expect(channelThreadProps(s, ready)).toEqual({
      targetMessageId: expected.message,
      targetReplyId: expected.replyProp,
    });
  });

  it('exposes the active target in every non-idle state', () => {
    for (const s of [targeting(NESTED), flashing(NESTED)]) {
      expect(activeTargetMessageId(s)).toBe('m1');
      expect(activeTargetMessageReplyId(s)).toBe('r1');
    }
    expect(activeTargetMessageId(idle())).toBeUndefined();
    expect(activeTargetMessageReplyId(idle())).toBeUndefined();
  });
});

describe('initialState', () => {
  it('starts idle without a target', () =>
    expect(initialState({})).toEqual(idle()));

  it('starts targeting and anchored on an initial target', () =>
    expect(initialState({ messageId: 'm1', replyId: 'r1' })).toEqual(
      targeting(NESTED, 'm1')
    ));
});

describe('sequences', () => {
  const states = (run: ReturnType<typeof simulate<State, Event, Command>>) =>
    run.steps.map((s) =>
      s.result === 'ignored' ? 'ignored' : s.result.state.t
    );

  it('root-only deep link: ack → flash (restoring) → release', () => {
    const run = simulate(targetMessageDef, initialState({ messageId: 'm1' }), [
      rootDone(),
      RESTORED,
      ELAPSED,
    ]);
    expect(run.commands).toEqual([RESTORE('m1')]);
    expect(states(run)).toEqual(['flashing', 'flashing', 'idle']);
    expect(run.state).toEqual(idle());
  });

  it('nested deep link: reply ack → flash (restoring) → release; a root ack is ignored', () => {
    const run = simulate(
      targetMessageDef,
      initialState({ messageId: 'm1', replyId: 'r1' }),
      [rootDone(), replyDone(), RESTORED, ELAPSED]
    );
    expect(states(run)).toEqual(['ignored', 'flashing', 'flashing', 'idle']);
    expect(run.commands).toEqual([RESTORE('m1')]);
    expect(run.state).toEqual(idle());
  });

  it('rapid navigation: a loaded second target keeps the first anchor in flight', () => {
    const run = simulate(targetMessageDef, idle(), [
      nav({ messageId: 'a' }, false),
      nav({ messageId: 'b' }, true),
    ]);
    expect(run.state).toEqual(targeting({ messageId: 'b' }, 'a'));
  });

  it('a failed restore leaves the anchor so the around-query stays the source', () => {
    const run = simulate(targetMessageDef, targeting(ROOT, 'm1'), [
      rootDone(),
      ELAPSED,
    ]);
    expect(run.state).toEqual(idle('m1'));
  });

  it('channel change mid-flight resets everything', () => {
    const run = simulate(targetMessageDef, targeting(NESTED, 'm1'), [RESET]);
    expect(run.state).toEqual(idle());
  });
});
