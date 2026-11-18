// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, expect, test, vi } from 'vitest';
import {
  initializeNativeKeyboardSurface,
  nativeAcknowledgementSurface,
} from '../../../../apps/web/src/lib/core/component/LexicalMarkdown/editing/test/native-keyboard-surface';
import { NativeEnterOutput } from './native-enter-output';

let restore: (() => void) | undefined;
beforeAll(() => {
  restore = initializeNativeKeyboardSurface();
});
afterAll(() => restore?.());
afterEach(() => vi.restoreAllMocks());

test('metadata-only text echo acknowledges the actual UTF-16 input without masking flags', async () => {
  const fixture = await nativeAcknowledgementSurface();
  const original = fixture.session.textFromView.bind(fixture.session);
  const flags: number[] = [];
  fixture.session.textFromView = (...args) => {
    const result = original(...args);
    flags.push(result);
    return result;
  };
  const ack = vi.spyOn(fixture.view, 'acknowledgeText');
  try {
    const text = fixture.view.getElementByKey(fixture.leaf.key)?.firstChild;
    if (!text) throw new Error('Missing actual text DOM');
    text.textContent = 'ab😀';
    fixture.port.textFromView({
      key: fixture.leaf.key,
      text: 'ab😀',
      anchorOffset: 4,
      focusOffset: 4,
    });
    expect(flags).toEqual([1]);
    expect(ack).toHaveBeenCalledTimes(1);
    expect(fixture.view.node(fixture.leaf.key)?.text).toBe('ab😀');
    expect(fixture.session.nodeText(fixture.leaf.key)).toBe('ab😀');
  } finally {
    await fixture.close();
  }
});

test.each([false, true])(
  'metadata-only selection echo acknowledges its actual route (cold=%s)',
  async (cold) => {
    const fixture = await nativeAcknowledgementSurface();
    const ack = vi.spyOn(fixture.view, 'acknowledgeSelection');
    const selection = {
      kind: 'range' as const,
      anchor: { key: fixture.leaf.key, type: 'text' as const, offset: 1 },
      focus: { key: fixture.leaf.key, type: 'text' as const, offset: 1 },
    };
    try {
      fixture.port.selectionFromView(selection, cold ? {} : undefined);
      expect(ack).toHaveBeenCalledTimes(1);
      expect(fixture.view.selection().selection).toEqual(selection);
    } finally {
      await fixture.close();
    }
  }
);

test('an actual consumed acknowledgement ticket cannot be replayed before another getter', async () => {
  const fixture = await nativeAcknowledgementSurface();
  const consume = NativeEnterOutput.prototype.consumeAcknowledgement;
  let accepted = 0;
  vi.spyOn(
    NativeEnterOutput.prototype,
    'consumeAcknowledgement'
  ).mockImplementation(function (this: NativeEnterOutput, ticket, flags) {
    const first = consume.call(this, ticket, flags);
    if (first) {
      accepted++;
      expect(consume.call(this, ticket, flags)).toBe(false);
    }
    return first;
  });
  try {
    fixture.port.textFromView({
      key: fixture.leaf.key,
      text: 'ab',
      anchorOffset: 2,
      focusOffset: 2,
    });
    expect(accepted).toBe(1);
    expect(fixture.view.node(fixture.leaf.key)?.text).toBe('ab');
  } finally {
    await fixture.close();
  }
});

test('an injected wrong ticket burns the real proof rather than acknowledging another entry', async () => {
  const fixture = await nativeAcknowledgementSurface();
  const consume = NativeEnterOutput.prototype.consumeAcknowledgement;
  vi.spyOn(
    NativeEnterOutput.prototype,
    'consumeAcknowledgement'
  ).mockImplementation(function (this: NativeEnterOutput, ticket, flags) {
    if (ticket && flags === 1) {
      expect(consume.call(this, {}, flags)).toBe(false);
      expect(consume.call(this, ticket, flags)).toBe(false);
      return false;
    }
    return consume.call(this, ticket, flags);
  });
  const ack = vi.spyOn(fixture.view, 'acknowledgeText');
  try {
    expect(() =>
      fixture.port.textFromView({
        key: fixture.leaf.key,
        text: 'ab',
        anchorOffset: 2,
        focusOffset: 2,
      })
    ).toThrow('TextFromView mirror divergence');
    expect(ack).not.toHaveBeenCalled();
    expect(fixture.view.node(fixture.leaf.key)?.text).toBe('a');
  } finally {
    await fixture.close();
  }
});

test.each(['same-owner', 'other-owner'] as const)(
  'beforeConsume receiver completion cannot bless the earlier text acknowledgement (%s)',
  async (mode) => {
    let armed = false;
    let completed = false;
    const other = await nativeAcknowledgementSurface();
    const fixture = await nativeAcknowledgementSurface((session) => {
      if (!armed || completed) return;
      completed = true;
      // Actual existing native call, not synthetic flags. Same-owner replaces the
      // pending packet; other-owner still changes the actual module completion cut.
      if (mode === 'same-owner') session.tick(1000, Date.now());
      else other.session.tick(1000, Date.now());
    });
    const ack = vi.spyOn(fixture.view, 'acknowledgeText');
    try {
      armed = true;
      expect(() =>
        fixture.port.textFromView({
          key: fixture.leaf.key,
          text: 'ab',
          anchorOffset: 2,
          focusOffset: 2,
        })
      ).toThrow('TextFromView mirror divergence');
      expect(completed).toBe(true);
      expect(ack).not.toHaveBeenCalled();
      expect(fixture.view.node(fixture.leaf.key)?.text).toBe('a');
    } finally {
      armed = false;
      await fixture.close();
      await other.close();
    }
  }
);

test('a queued selection entry uses its own acknowledgement after the text entry completes', async () => {
  let armed = false;
  let queued = false;
  let enqueue: (() => void) | undefined;
  const fixture = await nativeAcknowledgementSurface(() => {
    if (armed && !queued) {
      queued = true;
      enqueue?.();
    }
  });
  const textAck = vi.spyOn(fixture.view, 'acknowledgeText');
  const selectionAck = vi.spyOn(fixture.view, 'acknowledgeSelection');
  const selection = {
    kind: 'range' as const,
    anchor: { key: fixture.leaf.key, type: 'text' as const, offset: 1 },
    focus: { key: fixture.leaf.key, type: 'text' as const, offset: 1 },
  };
  enqueue = () => fixture.port.selectionFromView(selection, {});
  try {
    armed = true;
    fixture.port.textFromView({
      key: fixture.leaf.key,
      text: 'ab',
      anchorOffset: 2,
      focusOffset: 2,
    });
    expect(textAck).toHaveBeenCalledTimes(1);
    expect(selectionAck).toHaveBeenCalledTimes(1);
    expect(fixture.view.node(fixture.leaf.key)?.text).toBe('ab');
    expect(fixture.view.selection().selection).toEqual(selection);
  } finally {
    armed = false;
    await fixture.close();
  }
});

test('an authoritative read-only repair does not acquire a metadata-only text acknowledgement', async () => {
  const fixture = await nativeAcknowledgementSurface();
  fixture.executor.run(() =>
    fixture.session.authorization(
      true,
      false,
      false,
      fixture.executor.now(),
      Date.now()
    )
  );
  const ack = vi.spyOn(fixture.view, 'acknowledgeText');
  try {
    expect(() =>
      fixture.port.textFromView({
        key: fixture.leaf.key,
        text: 'rejected',
        anchorOffset: 8,
        focusOffset: 8,
      })
    ).toThrow('document is read-only');
    expect(ack).not.toHaveBeenCalled();
    expect(fixture.session.nodeText(fixture.leaf.key)).toBe('a');
    expect(fixture.view.node(fixture.leaf.key)?.text).toBe('a');
  } finally {
    await fixture.close();
  }
});

test('an injected truncated transfer cannot leak its ticket into the next healthy echo', async () => {
  const fixture = await nativeAcknowledgementSurface();
  const capture = NativeEnterOutput.prototype.captureAcknowledgement;
  const tickets: (object | undefined)[] = [];
  vi.spyOn(
    NativeEnterOutput.prototype,
    'captureAcknowledgement'
  ).mockImplementation(function (this: NativeEnterOutput, flags) {
    const ticket = capture.call(this, flags);
    tickets.push(ticket);
    return ticket;
  });
  const take = fixture.session.takeOutput.bind(fixture.session);
  const ack = vi.spyOn(fixture.view, 'acknowledgeText');
  let corrupt = true;
  fixture.session.takeOutput = () => {
    const actual = take();
    if (!corrupt) return actual;
    corrupt = false;
    return actual.subarray(0, actual.length - 1);
  };
  try {
    expect(() =>
      fixture.port.textFromView({
        key: fixture.leaf.key,
        text: 'ab',
        anchorOffset: 2,
        focusOffset: 2,
      })
    ).toThrow(/Truncated|Missing|Trailing/);
    expect(ack).not.toHaveBeenCalled();
    fixture.session.takeOutput = take;
    fixture.port.textFromView({
      key: fixture.leaf.key,
      text: 'abc',
      anchorOffset: 3,
      focusOffset: 3,
    });
    expect(tickets).toHaveLength(2);
    expect(tickets[0]).toBeDefined();
    expect(tickets[1]).toBeDefined();
    expect(tickets[0]).not.toBe(tickets[1]);
    expect(ack).toHaveBeenCalledTimes(1);
    expect(fixture.view.node(fixture.leaf.key)?.text).toBe('abc');
  } finally {
    fixture.session.takeOutput = take;
    await fixture.close();
  }
});
