/** @vitest-environment jsdom */

import { afterEach, beforeAll, expect, test, vi } from 'vitest';
import {
  initializeNativeSurfaceTests,
  nativeSurface,
} from './test/native-surface';

beforeAll(initializeNativeSurfaceTests);
afterEach(() => vi.restoreAllMocks());

/** Inline code "c" followed by plain "ody": the D018 boundary. */
function codeBoundary() {
  const fixture = nativeSurface();
  fixture.port.setState(
    JSON.stringify({
      root: {
        type: 'root',
        version: 1,
        children: [
          {
            type: 'paragraph',
            version: 1,
            children: [
              { type: 'text', version: 1, text: 'c', format: 16 },
              { type: 'text', version: 1, text: 'ody', format: 0 },
            ],
          },
        ],
      },
    })
  );
  const code = [...fixture.view.mirror.values()].find((n) => n.text === 'c');
  const plain = [...fixture.view.mirror.values()].find((n) => n.text === 'ody');
  if (!code || !plain) throw new Error('Missing boundary text nodes');
  const codeDOM = fixture.view.getElementByKey(code.key)?.firstChild;
  const plainDOM = fixture.view.getElementByKey(plain.key)?.firstChild;
  if (!codeDOM || !plainDOM) throw new Error('Missing boundary DOM text');
  return { fixture, code, plain, codeDOM, plainDOM };
}

test('a clean selectionchange echo normalizes the model point and keeps the browser caret', () => {
  const { fixture, code, plainDOM } = codeBoundary();
  try {
    fixture.view.root.focus();
    const dom = document.getSelection();
    if (!dom) throw new Error('Missing DOM selection');
    dom.setBaseAndExtent(plainDOM, 0, plainDOM, 0);
    const writes = vi.spyOn(Selection.prototype, 'setBaseAndExtent');
    document.dispatchEvent(new Event('selectionchange'));
    expect(fixture.view.selection().selection).toMatchObject({
      kind: 'range',
      anchor: { key: code.key, offset: 1, type: 'text' },
      focus: { key: code.key, offset: 1, type: 'text' },
    });
    expect(writes).not.toHaveBeenCalled();
    expect(dom.anchorNode).toBe(plainDOM);
    expect(dom.anchorOffset).toBe(0);
  } finally {
    fixture.close();
  }
});

test('the next typed character continues at the model point after a clean echo', () => {
  const { fixture, plainDOM } = codeBoundary();
  try {
    fixture.view.root.focus();
    document.getSelection()?.setBaseAndExtent(plainDOM, 0, plainDOM, 0);
    document.dispatchEvent(new Event('selectionchange'));
    fixture.view.root.dispatchEvent(
      new InputEvent('beforeinput', {
        inputType: 'insertText',
        data: 'x',
        bubbles: true,
        cancelable: true,
      })
    );
    const texts = [...fixture.view.mirror.values()]
      .filter((n) => n.kind === 'text')
      .map((n) => n.text);
    expect(texts).toEqual(['cx', 'ody']);
  } finally {
    fixture.close();
  }
});

test('a dirty DOM selection is written back', () => {
  const { fixture, code, plain, plainDOM } = codeBoundary();
  try {
    fixture.view.root.focus();
    document.getSelection()?.setBaseAndExtent(plainDOM, 0, plainDOM, 0);
    const writes = vi.spyOn(Selection.prototype, 'setBaseAndExtent');
    const point = { key: code.key, offset: 1, type: 'text' } as const;
    const selection = {
      kind: 'range',
      anchor: point,
      focus: point,
      dirty: true,
    } as const;
    fixture.view.submitDomSelection(
      () => fixture.port.selectionFromView(selection),
      selection
    );
    expect(writes).toHaveBeenCalled();
    expect(document.getSelection()?.anchorNode).not.toBe(plainDOM);
    expect(plain.key).not.toBe(code.key);
  } finally {
    fixture.close();
  }
});

test('the echo marker does not outlive its synchronous submission', () => {
  const { fixture, code, plainDOM } = codeBoundary();
  try {
    fixture.view.root.focus();
    document.getSelection()?.setBaseAndExtent(plainDOM, 0, plainDOM, 0);
    const point = { key: code.key, offset: 1, type: 'text' } as const;
    const clean = {
      kind: 'range',
      anchor: point,
      focus: point,
      dirty: false,
    } as const;
    fixture.view.submitDomSelection(() => {}, clean);
    const writes = vi.spyOn(Selection.prototype, 'setBaseAndExtent');
    fixture.port.selectionFromView(clean);
    expect(writes).toHaveBeenCalled();
  } finally {
    fixture.close();
  }
});
