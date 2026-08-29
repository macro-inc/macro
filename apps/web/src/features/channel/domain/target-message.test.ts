import { describe, expect, it } from 'vitest';
import {
  type Command,
  type MachineState,
  type Target,
  type TargetEvent,
  activeTargetMessageId,
  activeTargetMessageReplyId,
  idleState,
  initialState,
  loadAroundMessageId,
  makeTarget,
  pendingScrollTargetId,
  pendingTargetReplyId,
  reduce,
} from './target-message';

const loading = (
  value: Target,
  loadAround: string | undefined = value.messageId
): MachineState => ({
  control: { t: 'loading', target: value },
  loadAround,
});

const awaitingViewport = (
  value: Target,
  loadAround: string | undefined = value.messageId
): MachineState => ({
  control: { t: 'awaiting-viewport', target: value },
  loadAround,
});

const scrolling = (
  value: Target,
  rootDone = false,
  loadAround: string | undefined = value.messageId
): MachineState => ({
  control: { t: 'scrolling', target: value, rootDone },
  loadAround,
});

const flashing = (
  value: Target,
  loadAround: string | undefined = value.messageId
): MachineState => ({
  control: { t: 'flashing', target: value },
  loadAround,
});

const noAround = (state: MachineState): MachineState => ({
  ...state,
  loadAround: undefined,
});

const result = (
  state: MachineState,
  commands: Command[] = []
): ReturnType<typeof reduce> => ({
  state,
  commands,
});

const check = (
  state: MachineState,
  event: TargetEvent,
  expected: ReturnType<typeof reduce>
) => expect(reduce(state, event)).toEqual(expected);

describe('initialState', () => {
  it.each([
    {
      name: 'has no target',
      input: {},
      expected: idleState,
    },
    {
      name: 'starts loading around the initial root',
      input: { messageId: 'message-a' },
      expected: loading(makeTarget('message-a')),
    },
    {
      name: 'starts loading around the initial nested target',
      input: { messageId: 'message-a', replyId: 'reply-a' },
      expected: loading(makeTarget('message-a', 'reply-a')),
    },
    {
      name: 'starts awaiting-viewport when the constructor knows the target is loaded',
      input: { messageId: 'message-a', targetLoaded: true },
      expected: awaitingViewport(makeTarget('message-a')),
    },
  ])('$name', ({ input, expected }) => {
    expect(initialState(input)).toEqual(expected);
  });
});

describe('reduce', () => {
  const transitionRows = [
    {
      name: 'dedupes the same target while its root scroll is pending',
      state: loading(makeTarget('message-a', 'reply-a')),
      event: {
        t: 'navigate' as const,
        messageId: 'message-a',
        replyId: 'reply-a',
        targetLoaded: false,
      },
      expected: result(loading(makeTarget('message-a', 'reply-a'))),
    },
    {
      name: 'navigates to a missing target and replaces loadAround',
      state: flashing(makeTarget('message-a'), 'message-a'),
      event: {
        t: 'navigate' as const,
        messageId: 'message-b',
        targetLoaded: false,
      },
      expected: result(loading(makeTarget('message-b'), 'message-b'), [
        { t: 'cancel-flash' },
      ]),
    },
    {
      name: 'navigates to a loaded target and preserves loadAround',
      state: flashing(makeTarget('message-a'), 'message-a'),
      event: {
        t: 'navigate' as const,
        messageId: 'message-b',
        targetLoaded: true,
      },
      expected: result(awaitingViewport(makeTarget('message-b'), 'message-a'), [
        { t: 'cancel-flash' },
      ]),
    },
    {
      name: 'moves a loaded target to viewport waiting',
      state: loading(makeTarget('message-a'), 'message-a'),
      event: { t: 'target-loaded' as const },
      expected: result(awaitingViewport(makeTarget('message-a'), 'message-a')),
    },
    {
      name: 'starts root scrolling when the viewport is ready',
      state: awaitingViewport(makeTarget('message-a'), 'message-a'),
      event: { t: 'viewport-ready' as const },
      expected: result(scrolling(makeTarget('message-a'), false, 'message-a'), [
        {
          t: 'restore-default-pagination',
          loadAround: 'message-a',
        },
      ]),
    },
    {
      name: 'starts flashing after the matching root scroll completes',
      state: scrolling(makeTarget('message-a'), false, 'message-a'),
      event: { t: 'root-scroll-done' as const, messageId: 'message-a' },
      expected: result(flashing(makeTarget('message-a'), 'message-a'), [
        { t: 'schedule-flash', messageId: 'message-a' },
      ]),
    },
    {
      name: 'starts flashing after the matching reply scroll completes',
      state: scrolling(makeTarget('message-a', 'reply-a'), true, 'message-a'),
      event: {
        t: 'reply-scroll-done' as const,
        messageId: 'message-a',
        replyId: 'reply-a',
      },
      expected: result(flashing(makeTarget('message-a', 'reply-a'), 'message-a'), [
        { t: 'schedule-flash', messageId: 'message-a' },
      ]),
    },
    {
      name: 'releases a flashing target when its flash elapses',
      state: flashing(makeTarget('message-a'), 'message-a'),
      event: { t: 'flash-elapsed' as const, messageId: 'message-a' },
      expected: result({ ...idleState, loadAround: 'message-a' }),
    },
    {
      name: 'ignores a flash completion for another target',
      state: flashing(makeTarget('message-a'), 'message-a'),
      event: { t: 'flash-elapsed' as const, messageId: 'message-b' },
      expected: result(flashing(makeTarget('message-a'), 'message-a')),
    },
    {
      name: 'ignores a root scroll completion for another target',
      state: scrolling(makeTarget('message-a'), false, 'message-a'),
      event: { t: 'root-scroll-done' as const, messageId: 'message-b' },
      expected: result(scrolling(makeTarget('message-a'), false, 'message-a')),
    },
    {
      name: 'resets the machine and clears loadAround',
      state: flashing(makeTarget('message-a'), 'message-a'),
      event: { t: 'reset' as const },
      expected: result(idleState, [{ t: 'cancel-flash' }]),
    },
    {
      name: 'releases the matching active target',
      state: loading(makeTarget('message-a'), 'message-a'),
      event: { t: 'release' as const, messageId: 'message-a' },
      expected: result({ ...idleState, loadAround: 'message-a' }, [
        { t: 'cancel-flash' },
      ]),
    },
    {
      name: 'ignores a release for another target',
      state: loading(makeTarget('message-a'), 'message-a'),
      event: { t: 'release' as const, messageId: 'message-b' },
      expected: result(loading(makeTarget('message-a'), 'message-a')),
    },
    {
      name: 'clears loadAround after pagination restoration',
      state: scrolling(makeTarget('message-a'), false, 'message-a'),
      event: { t: 'pagination-restored' as const },
      expected: result(noAround(scrolling(makeTarget('message-a'), false))),
    },
    {
      name: 'ignores root-scroll-done before scrolling',
      state: loading(makeTarget('message-a')),
      event: { t: 'root-scroll-done' as const, messageId: 'message-a' },
      expected: result(loading(makeTarget('message-a'))),
    },
    {
      name: 'ignores root-scroll-done while awaiting-viewport',
      state: awaitingViewport(makeTarget('message-a', 'reply-a')),
      event: { t: 'root-scroll-done' as const, messageId: 'message-a' },
      expected: result(awaitingViewport(makeTarget('message-a', 'reply-a'))),
    },
  ];

  it.each(transitionRows)('$name', ({ state, event, expected }) => {
    check(state, event, expected);
  });

  it('marks a nested root complete when the viewport is ready', () => {
    check(
      noAround(awaitingViewport(makeTarget('message-a', 'reply-a'))),
      { t: 'viewport-ready' },
      result(noAround(scrolling(makeTarget('message-a', 'reply-a'), true)))
    );
  });

  it('does not clear loadAround while requesting default pagination', () => {
    check(
      awaitingViewport(makeTarget('message-a'), 'message-a'),
      { t: 'viewport-ready' },
      result(scrolling(makeTarget('message-a'), false, 'message-a'), [
        {
          t: 'restore-default-pagination',
          loadAround: 'message-a',
        },
      ])
    );
  });

  it('keeps the first loadAround during rapid navigation to a loaded target', () => {
    const first = reduce(idleState, {
      t: 'navigate',
      messageId: 'message-a',
      targetLoaded: false,
    });
    expect(first).toEqual(
      result(loading(makeTarget('message-a'), 'message-a'), [
        { t: 'cancel-flash' },
      ])
    );

    check(
      first.state,
      {
        t: 'navigate',
        messageId: 'message-b',
        targetLoaded: true,
      },
      result(awaitingViewport(makeTarget('message-b'), 'message-a'), [
        { t: 'cancel-flash' },
      ])
    );
  });

  it('ignores a stale flash completion after navigation', () => {
    const navigated = reduce(flashing(makeTarget('message-a'), 'message-a'), {
      t: 'navigate',
      messageId: 'message-b',
      targetLoaded: false,
    });

    check(
      navigated.state,
      { t: 'flash-elapsed', messageId: 'message-a' },
      result(navigated.state)
    );
  });

  const mismatchedScrollRows = [
    {
      name: 'root message id',
      state: scrolling(makeTarget('message-a'), false),
      event: { t: 'root-scroll-done' as const, messageId: 'message-b' },
    },
    {
      name: 'root completion after nested rootDone',
      state: scrolling(makeTarget('message-a', 'reply-a'), true),
      event: { t: 'root-scroll-done' as const, messageId: 'message-a' },
    },
    {
      name: 'reply message id',
      state: scrolling(makeTarget('message-a', 'reply-a'), true),
      event: {
        t: 'reply-scroll-done' as const,
        messageId: 'message-b',
        replyId: 'reply-a',
      },
    },
    {
      name: 'reply id',
      state: scrolling(makeTarget('message-a', 'reply-a'), true),
      event: {
        t: 'reply-scroll-done' as const,
        messageId: 'message-a',
        replyId: 'reply-b',
      },
    },
    {
      name: 'reply completion for a root target',
      state: scrolling(makeTarget('message-a'), false),
      event: {
        t: 'reply-scroll-done' as const,
        messageId: 'message-a',
        replyId: 'reply-a',
      },
    },
  ];

  it.each(mismatchedScrollRows)(
    'ignores a mismatched $name completion',
    ({ state, event }) => {
      check(state, event, result(state));
    }
  );

  const pendingDedupeStates = [
    loading(makeTarget('message-a', 'reply-a')),
    awaitingViewport(makeTarget('message-a', 'reply-a')),
    scrolling(makeTarget('message-a', 'reply-a'), false),
  ];

  it.each(pendingDedupeStates)(
    'dedupes same-target navigation while pending %#',
    (state) => {
      check(
        state,
        {
          t: 'navigate',
          messageId: 'message-a',
          replyId: 'reply-a',
          targetLoaded: true,
        },
        result(state)
      );
    }
  );

  const nonDedupeRows = [
    {
      name: 'flashing',
      state: flashing(makeTarget('message-a', 'reply-a')),
    },
    {
      name: 'nested root completion',
      state: scrolling(makeTarget('message-a', 'reply-a'), true),
    },
  ];

  it.each(nonDedupeRows)(
    'does not dedupe same-target navigation during $name',
    ({ state }) => {
      check(
        state,
        {
          t: 'navigate',
          messageId: 'message-a',
          replyId: 'reply-a',
          targetLoaded: true,
        },
        result(awaitingViewport(makeTarget('message-a', 'reply-a'), 'message-a'), [
          { t: 'cancel-flash' },
        ])
      );
    }
  );

  const wrongControlRows = [
    {
      state: idleState,
      event: { t: 'target-loaded' as const },
    },
    {
      state: loading(makeTarget('message-a')),
      event: { t: 'viewport-ready' as const },
    },
    {
      state: awaitingViewport(makeTarget('message-a', 'reply-a')),
      event: {
        t: 'reply-scroll-done' as const,
        messageId: 'message-a',
        replyId: 'reply-a',
      },
    },
  ];

  it.each(wrongControlRows)(
    'ignores an event in the wrong control state %#',
    ({ state, event }) => {
      check(state, event, result(state));
    }
  );
});

describe('selectors', () => {
  const selectorRows = [
    {
      name: 'idle',
      state: idleState,
      expected: [undefined, undefined, undefined, undefined, undefined],
    },
    {
      name: 'loading',
      state: loading(makeTarget('message-a', 'reply-a')),
      expected: ['message-a', 'reply-a', 'message-a', 'message-a', 'reply-a'],
    },
    {
      name: 'awaiting viewport',
      state: awaitingViewport(makeTarget('message-a', 'reply-a')),
      expected: ['message-a', 'reply-a', 'message-a', 'message-a', 'reply-a'],
    },
    {
      name: 'scrolling a root',
      state: scrolling(makeTarget('message-a'), false),
      expected: ['message-a', undefined, 'message-a', 'message-a', undefined],
    },
    {
      name: 'scrolling a reply',
      state: scrolling(makeTarget('message-a', 'reply-a'), true),
      expected: ['message-a', 'reply-a', 'message-a', undefined, 'reply-a'],
    },
    {
      name: 'flashing',
      state: flashing(makeTarget('message-a', 'reply-a')),
      expected: ['message-a', 'reply-a', 'message-a', undefined, undefined],
    },
  ];

  it.each(selectorRows)('returns values for $name', ({ state, expected }) => {
    expect([
      activeTargetMessageId(state),
      activeTargetMessageReplyId(state),
      loadAroundMessageId(state),
      pendingScrollTargetId(state),
      pendingTargetReplyId(state),
    ]).toEqual(expected);
  });
});
