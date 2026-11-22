// Geometry contracts only; no native iOS keyboard or animation acceptance.
import {
  setVirtualKeyboardHeight,
  setVirtualKeyboardVisible,
} from '@core/mobile/virtualKeyboard';
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $setSelection,
  type ParagraphNode,
  type TextNode,
} from 'lexical';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { iosCursorScrollPlugin } from '../plugins/ios-cursor-scroll/iosCursorScrollPlugin';
import { behaviorEditor } from './editor';

const CONTAINERS: HTMLElement[] = [];

beforeEach(() => {
  vi.useFakeTimers();
  setVirtualKeyboardVisible(false);
  setVirtualKeyboardHeight(0);
  vi.stubGlobal('visualViewport', { height: 600 });
});

afterEach(() => {
  setVirtualKeyboardVisible(false);
  setVirtualKeyboardHeight(0);
  for (const container of CONTAINERS.splice(0)) container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function caretFixture(caretBottom: number, containerBottom = 800) {
  const container = document.createElement('div');
  container.getBoundingClientRect = () =>
    new DOMRect(0, 0, 800, containerBottom);
  const scroll = vi.fn();
  container.scrollBy = scroll;
  document.body.append(container);
  CONTAINERS.push(container);
  const { editor, root } = behaviorEditor(
    iosCursorScrollPlugin({ scrollContainer: () => container })
  );
  container.append(root);
  let key = '';
  editor.update(
    () => {
      const paragraph = $createParagraphNode().append(
        $createTextNode('Caret text')
      );
      $getRoot().append(paragraph);
      paragraph.selectEnd();
      key = paragraph.getKey();
    },
    { discrete: true }
  );
  const paragraph = editor.getElementByKey(key);
  if (!paragraph) throw new Error('Expected mounted paragraph');
  // jsdom has no layout. Supply only geometry; the production caret utility
  // still resolves the real selection and mounted top-level element.
  paragraph.getBoundingClientRect = () =>
    new DOMRect(0, caretBottom - 20, 10, 20);
  window.getSelection()?.removeAllRanges();
  return { editor, scroll };
}

describe('iOS caret scroll geometry', () => {
  it.each([
    {
      name: 'visual viewport',
      caret: 600,
      container: 800,
      keyboard: 0,
      distance: 50,
    },
    {
      name: 'native keyboard inset',
      caret: 500,
      container: 800,
      keyboard: 200,
      distance: 150,
    },
    {
      name: 'shorter scroll container',
      caret: 500,
      container: 400,
      keyboard: 0,
      distance: 150,
    },
  ])(
    'uses the $name bottom with fifty pixels of caret padding',
    ({ caret, container, keyboard, distance }) => {
      const { scroll } = caretFixture(caret, container);
      setVirtualKeyboardHeight(keyboard);
      setVirtualKeyboardVisible(true);
      vi.runOnlyPendingTimers();
      expect(scroll.mock.calls).toEqual([
        [{ top: distance, behavior: 'smooth' }],
      ]);
    }
  );

  it.each([550, 500])(
    'does not scroll a caret at or above the safe boundary: %s',
    (bottom) => {
      const { scroll } = caretFixture(bottom);
      setVirtualKeyboardVisible(true);
      vi.runOnlyPendingTimers();
      expect(scroll).not.toHaveBeenCalled();
    }
  );

  it('falls back to window height when visual viewport is unavailable', () => {
    vi.stubGlobal('visualViewport', undefined);
    vi.stubGlobal('innerHeight', 700);
    const { scroll } = caretFixture(700);
    setVirtualKeyboardVisible(true);
    vi.runOnlyPendingTimers();
    expect(scroll.mock.calls).toEqual([[{ top: 50, behavior: 'smooth' }]]);
  });

  it('does not scroll when both DOM and model caret selections are absent', () => {
    const { editor, scroll } = caretFixture(700);
    editor.update(() => $setSelection(null), { discrete: true });
    window.getSelection()?.removeAllRanges();
    setVirtualKeyboardVisible(true);
    vi.runOnlyPendingTimers();
    expect(scroll).not.toHaveBeenCalled();
  });

  it('does not schedule scrolling for committed edits while the keyboard is hidden', () => {
    const { editor, scroll } = caretFixture(700);
    editor.update(
      () => {
        $getRoot()
          .getFirstChildOrThrow<ParagraphNode>()
          .getFirstChildOrThrow<TextNode>()
          .setTextContent('Committed edit');
      },
      { discrete: true }
    );
    window.getSelection()?.removeAllRanges();
    vi.runOnlyPendingTimers();
    expect(editor.read(() => $getRoot().getTextContent())).toBe(
      'Committed edit'
    );
    expect(scroll).not.toHaveBeenCalled();
  });
});
