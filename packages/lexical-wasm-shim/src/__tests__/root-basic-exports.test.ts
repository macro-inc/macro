import * as Original from 'lexical';
import { expect, test } from 'vitest';
import * as Actual from '../index';

test('render config getter keeps its default editor argument and explicit pure path', () => {
  const original = Original.createEditor();
  const actual = Actual.createEditor();
  try {
    expect(Actual.$getEditorDOMRenderConfig.length).toBe(
      Original.$getEditorDOMRenderConfig.length
    );
    expect(Actual.$getEditorDOMRenderConfig(actual)).toBe(actual._config.dom);
    expect(Original.$getEditorDOMRenderConfig(original)).toBe(
      original._config.dom
    );
    expect(() => Actual.$getEditorDOMRenderConfig()).toThrow('active editor');
    actual.update(() =>
      expect(Actual.$getEditorDOMRenderConfig()).toBe(actual._config.dom)
    );
  } finally {
    actual.dispose();
  }
});

test('selection factories expose actual source objects with pinned initial fields', () => {
  const actual = Actual.$createRangeSelection();
  const original = Original.$createRangeSelection();
  expect(Actual.$isRangeSelection(actual)).toBe(true);
  expect(Actual.$isNodeSelection(actual)).toBe(false);
  expect([
    actual.anchor.key,
    actual.anchor.offset,
    actual.anchor.type,
    actual.focus.key,
    actual.format,
    actual.style,
  ]).toEqual([
    original.anchor.key,
    original.anchor.offset,
    original.anchor.type,
    original.focus.key,
    original.format,
    original.style,
  ]);
  const nodeSelection = Actual.$createNodeSelection();
  expect(Actual.$isNodeSelection(nodeSelection)).toBe(true);
  expect(nodeSelection._nodes.size).toBe(
    Original.$createNodeSelection()._nodes.size
  );
});

test('tab creation reaches the actual registered replacement just like Original', () => {
  const original = Original.createEditor();
  const actual = Actual.createEditor();
  const cause = {};
  try {
    for (const { editor, create } of [
      { editor: original, create: Original.$createTabNode },
      { editor: actual, create: Actual.$createTabNode },
    ]) {
      const row = editor._nodes.get('tab');
      if (!row) throw new Error('Missing actual tab registration');
      Object.defineProperty(row, 'replace', {
        get() {
          throw cause;
        },
      });
      editor.update(() => expect(() => create()).toThrow(cause), {
        discrete: true,
      });
    }
  } finally {
    actual.dispose();
  }
});
