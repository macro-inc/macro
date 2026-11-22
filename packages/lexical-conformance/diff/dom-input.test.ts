import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { Command } from './commands';
import { Comparison } from './compare';
import { DOMInputCore } from './dom-input';
import { Upstream } from './upstream';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

test('logical DOM route preserves the direction-only six-operation selection skip', async () => {
  const upstream = new Upstream();
  const native = new DOMInputCore('upstream');
  const comparison = new Comparison();
  const fixture: { commands: Command[] } = {
    commands: [
      { kind: 'InsertText', text: '\n𝔸\u2028' },
      { kind: 'InsertLineBreak' },
      { kind: 'InsertTab' },
      { kind: 'InsertText', text: '👩‍👩‍👧éZ' },
      {
        kind: 'Select',
        anchor: { path: [0, 3], offset: 8, type: 'text' },
        focus: { path: [0, 3], offset: 6, type: 'text' },
      },
      {
        kind: 'SelectionFromView',
        anchor: { path: [0, 3], offset: 6, type: 'text' },
        focus: { path: [0, 3], offset: 8, type: 'text' },
      },
    ],
  };
  try {
    for (const command of fixture.commands)
      comparison.compare(
        await upstream.apply(command),
        JSON.parse(await native.apply(JSON.stringify(command), 0))
      );
    expect(
      native.events.map(({ skipped, admitted, coalesced }) => ({
        skipped,
        admitted,
        coalesced,
      }))
    ).toEqual([{ skipped: true, admitted: false, coalesced: false }]);
  } finally {
    upstream.dispose();
    native.free();
  }
});

test('logical DOM route rejects a changed later accepted payload', async () => {
  const native = new DOMInputCore('upstream');
  try {
    await native.apply(
      JSON.stringify({ kind: 'InsertText', text: 'abcdef' }),
      0
    );
    const frame = document.querySelector('iframe');
    const doc = frame?.contentDocument;
    if (!doc) throw new Error('Missing isolated input document');
    let explicitSeen = false;
    let changed = false;
    const mutateLaterPayload = (event: Event) => {
      if (!event.isTrusted) {
        explicitSeen = true;
        return;
      }
      if (!explicitSeen || changed) return;
      changed = true;
      const selection = doc.getSelection();
      const text = doc
        .createTreeWalker(doc.body, NodeFilter.SHOW_TEXT)
        .nextNode();
      if (!selection || !text) throw new Error('Missing negative-control text');
      selection.setBaseAndExtent(text, 0, text, 0);
    };
    const before = native.snapshot();
    doc.addEventListener('selectionchange', mutateLaterPayload);
    try {
      await expect(
        native.apply(
          JSON.stringify({
            kind: 'SelectionFromView',
            anchor: { path: [0, 0], type: 'text', offset: 2 },
            focus: { path: [0, 0], type: 'text', offset: 2 },
          }),
          0
        )
      ).rejects.toThrow('changed accepted DOM endpoints');
      expect(changed).toBe(true);
      expect(native.snapshot()).toBe(before);
      expect(native.events.every((event) => !event.admitted)).toBe(true);
    } finally {
      doc.removeEventListener('selectionchange', mutateLaterPayload);
    }
  } finally {
    native.free();
  }
});

test('logical DOM route rejects unsupported selection context before native admission', async () => {
  const native = new DOMInputCore('upstream');
  try {
    const before = native.snapshot();
    await expect(
      native.apply(
        JSON.stringify({
          kind: 'SelectionFromView',
          anchor: { path: [0], offset: 0, type: 'element' },
          focus: { path: [0], offset: 0, type: 'element' },
          postDeleteRestore: { anchor: 1 },
        }),
        0
      )
    ).rejects.toThrow('Unsupported native logical-input selection context');
    expect(native.snapshot()).toBe(before);
    expect(native.events).toEqual([]);
  } finally {
    native.free();
  }
});
