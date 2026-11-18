/** @vitest-environment jsdom */

import { CommandCode } from '@macro-inc/collaboration/session/abi.generated';
import { createEditor } from 'lexical';
import { beforeAll, expect, test, vi } from 'vitest';
import { registerExternalEditorRoot } from './editor-roots';
import {
  consumeSelectionChangeFromDOMUpdate,
  markSelectionChangeFromDOMUpdate,
  shouldSkipDOMSelectionChange,
} from './selection-change';
import {
  initializeNativeSurfaceTests,
  nativeSurface,
} from './test/native-surface';

beforeAll(initializeNativeSurfaceTests);

test('raw endpoints preserve boundary, element and post-delete normalization', () => {
  const text = document.createTextNode('abcd');
  const element = document.createElement('p');
  expect(shouldSkipDOMSelectionChange(true, text, 1, text, 3, false)).toBe(
    true
  );
  expect(shouldSkipDOMSelectionChange(false, text, 1, text, 3, false)).toBe(
    false
  );
  expect(shouldSkipDOMSelectionChange(true, text, 1, text, 3, true)).toBe(
    false
  );
  for (const offset of [0, 4]) {
    expect(
      shouldSkipDOMSelectionChange(true, text, offset, text, 2, false)
    ).toBe(false);
    expect(
      shouldSkipDOMSelectionChange(true, text, 2, text, offset, false)
    ).toBe(false);
  }
  expect(shouldSkipDOMSelectionChange(true, element, 1, text, 2, false)).toBe(
    false
  );
  expect(shouldSkipDOMSelectionChange(true, text, 1, element, 2, false)).toBe(
    false
  );
  expect(shouldSkipDOMSelectionChange(true, null, 1, text, 2, false)).toBe(
    false
  );
  expect(
    shouldSkipDOMSelectionChange(
      true,
      { nodeType: 3, nodeValue: null },
      1,
      text,
      2,
      false
    )
  ).toBe(false);
});

test('the first event consumes the shared mark even when normalization continues', () => {
  const text = document.createTextNode('abcd');
  document.body.append(text);
  const selection = document.getSelection();
  if (!selection) throw new Error('Missing DOM selection');
  try {
    for (const postDelete of [false, true]) {
      selection.setBaseAndExtent(text, 0, text, 2);
      markSelectionChangeFromDOMUpdate();
      expect(consumeSelectionChangeFromDOMUpdate(selection, postDelete)).toBe(
        false
      );
      selection.setBaseAndExtent(text, 1, text, 2);
      expect(consumeSelectionChangeFromDOMUpdate(selection, false)).toBe(false);
    }
    markSelectionChangeFromDOMUpdate();
    selection.setBaseAndExtent(text, 1, text, 2);
    expect(consumeSelectionChangeFromDOMUpdate(selection, false)).toBe(true);
    expect(consumeSelectionChangeFromDOMUpdate(selection, false)).toBe(false);
  } finally {
    text.remove();
  }
});

test('six-operation backward range keeps model direction on the first own-DOM event only', () => {
  const fixture = nativeSurface();
  const hydration = (event: Event) => event.stopImmediatePropagation();
  document.addEventListener('selectionchange', hydration, true);
  try {
    fixture.root.tabIndex = 0;
    fixture.root.focus();
    expect(document.activeElement).toBe(fixture.root);
    fixture.port.command(CommandCode.InsertText, 0, 0, '\n𝔸\u2028');
    fixture.port.command(CommandCode.InsertLineBreak);
    fixture.port.command(CommandCode.InsertTab);
    fixture.port.command(CommandCode.InsertText, 0, 0, '👩‍👩‍👧éZ');
    const leaf = [...fixture.view.mirror.values()].find(
      (node) => node.text === '👩‍👩‍👧éZ'
    );
    if (!leaf) throw new Error('Missing tape text');
    const backward = {
      kind: 'range' as const,
      anchor: { key: leaf.key, offset: 8, type: 'text' as const },
      focus: { key: leaf.key, offset: 6, type: 'text' as const },
    };
    fixture.port.selectionFromView(backward);
    const dom = document.getSelection();
    const element = fixture.view.getElementByKey(leaf.key);
    if (!element) throw new Error('Missing tape element');
    const text = document
      .createTreeWalker(element, NodeFilter.SHOW_TEXT)
      .nextNode();
    if (!dom || !text) throw new Error('Missing tape DOM');
    document.removeEventListener('selectionchange', hydration, true);
    fixture.counters.admissions = 0;
    dom.setBaseAndExtent(text, 6, text, 8);
    document.dispatchEvent(new Event('selectionchange'));
    expect(fixture.view.selection().selection).toEqual(backward);
    expect(fixture.counters.admissions).toBe(0);
    document.dispatchEvent(new Event('selectionchange'));
    expect(fixture.view.selection().selection).toEqual({
      ...backward,
      dirty: false,
      anchor: { ...backward.anchor, offset: 6 },
      focus: { ...backward.focus, offset: 8 },
    });
    expect(fixture.counters.admissions).toBe(1);
  } finally {
    document.removeEventListener('selectionchange', hydration, true);
    fixture.close();
  }
});

test.each([
  'null',
  'outside',
  'external',
  'owned-anchor-outside-focus',
] as const)(
  'native event routing handles %s anchors before consuming the pending mark',
  (kind) => {
    const fixture = nativeSurface();
    const outside = document.createTextNode('outside');
    const sourceRoot = document.createElement('div');
    const sourceText = document.createTextNode('source');
    const source = createEditor({
      onError(error) {
        throw error;
      },
    });
    let releaseRoot: (() => void) | undefined;
    const release = source.registerRootListener((root) => {
      releaseRoot?.();
      releaseRoot = root ? registerExternalEditorRoot(root, source) : undefined;
    });
    source.setRootElement(sourceRoot);
    sourceRoot.append(sourceText);
    document.body.append(outside);
    try {
      fixture.port.setState(
        JSON.stringify({
          root: {
            type: 'root',
            children: [
              { type: 'paragraph', children: [{ type: 'text', text: 'abcd' }] },
            ],
          },
        })
      );
      fixture.root.append(sourceRoot);
      fixture.root.tabIndex = 0;
      fixture.root.focus();
      const leaf = [...fixture.view.mirror.values()].find(
        (node) => node.text === 'abcd'
      );
      if (!leaf) throw new Error('Missing native leaf');
      const element = fixture.view.getElementByKey(leaf.key);
      if (!element) throw new Error('Missing native element');
      const text = document
        .createTreeWalker(element, NodeFilter.SHOW_TEXT)
        .nextNode();
      const dom = document.getSelection();
      if (!text || !dom) throw new Error('Missing native range');
      const backward = {
        kind: 'range' as const,
        anchor: { key: leaf.key, type: 'text' as const, offset: 3 },
        focus: { key: leaf.key, type: 'text' as const, offset: 1 },
      };
      fixture.port.selectionFromView(backward);
      if (kind === 'null') dom.removeAllRanges();
      else if (kind === 'outside') dom.setBaseAndExtent(outside, 1, outside, 3);
      else if (kind === 'external')
        dom.setBaseAndExtent(sourceText, 1, sourceText, 3);
      else dom.setBaseAndExtent(text, 1, outside, 3);
      fixture.counters.admissions = 0;
      document.dispatchEvent(new Event('selectionchange'));
      expect(fixture.counters.admissions).toBe(0);
      dom.setBaseAndExtent(text, 1, text, 3);
      document.dispatchEvent(new Event('selectionchange'));
      if (kind === 'owned-anchor-outside-focus') {
        expect(fixture.view.selection().selection).toEqual({
          ...backward,
          dirty: false,
          anchor: { ...backward.anchor, offset: 1 },
          focus: { ...backward.focus, offset: 3 },
        });
        expect(fixture.counters.admissions).toBe(1);
      } else {
        expect(fixture.view.selection().selection).toEqual(backward);
        expect(fixture.counters.admissions).toBe(0);
      }
    } finally {
      source.setRootElement(null);
      release();
      releaseRoot?.();
      outside.remove();
      fixture.close();
    }
  }
);

test('the anchor editor consumes the shared mark while another native root has focus', () => {
  const first = nativeSurface();
  const second = nativeSurface();
  try {
    for (const fixture of [first, second]) {
      fixture.port.setState(
        JSON.stringify({
          root: {
            type: 'root',
            children: [
              { type: 'paragraph', children: [{ type: 'text', text: 'abcd' }] },
            ],
          },
        })
      );
      fixture.root.tabIndex = 0;
    }
    first.root.focus();
    const firstSelection = structuredClone(first.view.selection().selection);
    const leaf = [...second.view.mirror.values()].find(
      (node) => node.text === 'abcd'
    );
    if (!leaf) throw new Error('Missing second native leaf');
    const backward = {
      kind: 'range' as const,
      anchor: { key: leaf.key, type: 'text' as const, offset: 3 },
      focus: { key: leaf.key, type: 'text' as const, offset: 1 },
    };
    second.port.selectionFromView(backward);
    expect(document.activeElement).toBe(first.root);
    const element = second.view.getElementByKey(leaf.key);
    if (!element) throw new Error('Missing second native element');
    const text = document
      .createTreeWalker(element, NodeFilter.SHOW_TEXT)
      .nextNode();
    const dom = document.getSelection();
    if (!text || !dom) throw new Error('Missing second native DOM range');
    first.counters.admissions = 0;
    second.counters.admissions = 0;
    dom.setBaseAndExtent(text, 1, text, 3);
    document.dispatchEvent(new Event('selectionchange'));
    expect(second.view.selection().selection).toEqual(backward);
    document.dispatchEvent(new Event('selectionchange'));
    expect(second.view.selection().selection).toEqual({
      ...backward,
      dirty: false,
      anchor: { ...backward.anchor, offset: 1 },
      focus: { ...backward.focus, offset: 3 },
    });
    expect(first.view.selection().selection).toEqual(firstSelection);
    expect(first.counters.admissions).toBe(0);
    expect(second.counters.admissions).toBe(1);
  } finally {
    first.close();
    second.close();
  }
});

test.each([0, 4, 'element'] as const)(
  'an own-write mark does not skip a raw %s endpoint',
  (endpoint) => {
    const fixture = nativeSurface();
    try {
      fixture.port.setState(
        JSON.stringify({
          root: {
            type: 'root',
            children: [
              { type: 'paragraph', children: [{ type: 'text', text: 'abcd' }] },
            ],
          },
        })
      );
      const leaf = [...fixture.view.mirror.values()].find(
        (node) => node.text === 'abcd'
      );
      if (!leaf) throw new Error('Missing boundary leaf');
      const element = fixture.view.getElementByKey(leaf.key);
      if (!element) throw new Error('Missing boundary element');
      const text = document
        .createTreeWalker(element, NodeFilter.SHOW_TEXT)
        .nextNode();
      const dom = document.getSelection();
      if (!text || !dom) throw new Error('Missing boundary range');
      fixture.port.selectionFromView({
        kind: 'range',
        anchor: { key: leaf.key, type: 'text', offset: 3 },
        focus: { key: leaf.key, type: 'text', offset: 1 },
      });
      fixture.counters.admissions = 0;
      if (endpoint === 'element') {
        const paragraph = element.parentNode;
        if (!paragraph) throw new Error('Missing boundary paragraph');
        dom.setBaseAndExtent(paragraph, 0, text, 2);
      } else dom.setBaseAndExtent(text, endpoint, text, 2);
      document.dispatchEvent(new Event('selectionchange'));
      expect(fixture.counters.admissions).toBe(1);
    } finally {
      fixture.close();
    }
  }
);

test('an Android post-delete restore passes through an armed own-write guard', () => {
  const userAgent = vi
    .spyOn(navigator, 'userAgent', 'get')
    .mockReturnValue('Android Chrome');
  const fixture = nativeSurface();
  try {
    fixture.port.setState(
      JSON.stringify({
        root: {
          type: 'root',
          children: [
            { type: 'paragraph', children: [{ type: 'text', text: 'abcd' }] },
          ],
        },
      })
    );
    const leaf = [...fixture.view.mirror.values()].find(
      (node) => node.text === 'abcd'
    );
    if (!leaf) throw new Error('Missing delete leaf');
    fixture.port.selectionFromView({
      kind: 'range',
      anchor: { key: leaf.key, type: 'text', offset: 2 },
      focus: { key: leaf.key, type: 'text', offset: 2 },
    });
    const beforeElement = fixture.view.getElementByKey(leaf.key);
    if (!beforeElement) throw new Error('Missing pre-delete element');
    const beforeText = document
      .createTreeWalker(beforeElement, NodeFilter.SHOW_TEXT)
      .nextNode();
    if (!beforeText) throw new Error('Missing pre-delete text');
    const deletion = new InputEvent('beforeinput', {
      bubbles: true,
      cancelable: true,
      inputType: 'deleteWordBackward',
    });
    // Supply the browser's target-range fact; the real handler and native delete
    // command execute unchanged. Ordinary Android character deletion yields to DOM.
    Object.defineProperty(deletion, 'getTargetRanges', {
      value: () => [
        new StaticRange({
          startContainer: beforeText,
          startOffset: 1,
          endContainer: beforeText,
          endOffset: 2,
        }),
      ],
    });
    fixture.root.dispatchEvent(deletion);
    const element = fixture.view.getElementByKey(leaf.key);
    if (!element) throw new Error('Missing post-delete element');
    const text = document
      .createTreeWalker(element, NodeFilter.SHOW_TEXT)
      .nextNode();
    const dom = document.getSelection();
    if (!text || !dom) throw new Error('Missing post-delete range');
    expect(text.nodeValue).toBe('acd');
    const contexts: Parameters<typeof fixture.port.selectionFromView>[1][] = [];
    const submit = fixture.port.selectionFromView.bind(fixture.port);
    fixture.port.selectionFromView = (selection, context) => {
      contexts.push(context);
      submit(selection, context);
    };
    fixture.counters.admissions = 0;
    dom.setBaseAndExtent(text, 2, text, 2);
    document.dispatchEvent(new Event('selectionchange'));
    expect(fixture.counters.admissions).toBe(1);
    expect(contexts).toHaveLength(1);
    expect(contexts[0]?.postDeleteRestore?.anchor.offset).toBe(1);
  } finally {
    fixture.close();
    userAgent.mockRestore();
  }
});
