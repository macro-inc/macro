import { $createListItemNode, $createListNode } from '@lexical/list';
import { TASK_LIST_BAR_CLASS } from '@macro-inc/lexical-core';
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  $setSelection,
} from 'lexical';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { restoreFocusPlugin } from '../plugins/restore-focus/restoreFocusPlugin';
import { behaviorEditor } from './editor';

beforeEach(() => {
  vi.useFakeTimers();
  const createRange = document.createRange.bind(document);
  vi.spyOn(document, 'createRange').mockImplementation(() => {
    const range = createRange();
    // jsdom implements native ranges but not their layout geometry.
    range.getBoundingClientRect = () => new DOMRect();
    return range;
  });
  const selection = window.getSelection();
  if (!selection) throw new Error('Expected native DOM Selection');
  const getRangeAt = selection.getRangeAt.bind(selection);
  vi.spyOn(selection, 'getRangeAt').mockImplementation((index) => {
    // setBaseAndExtent creates ranges internally, bypassing createRange.
    const range = getRangeAt(index);
    range.getBoundingClientRect = () => new DOMRect();
    return range;
  });
});
afterEach(() => {
  window.getSelection()?.removeAllRanges();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function focusFixture() {
  let unregister: (() => void) | undefined;
  const dispose = () => {
    unregister?.();
    unregister = undefined;
  };
  const { editor, root } = behaviorEditor((editor) => {
    unregister = restoreFocusPlugin('rootEnd')(editor);
    return dispose;
  });
  // jsdom does not reflect contentEditable into focusability. Keep the real
  // DOM focus path reachable without replacing editor.focus.
  root.tabIndex = 0;
  editor.update(
    () => {
      $getRoot().append($createParagraphNode().append($createTextNode('Seed')));
      $setSelection(null);
    },
    { discrete: true }
  );
  return { editor, root, dispose };
}

function focusIn(root: HTMLElement) {
  const event = new FocusEvent('focusin', { bubbles: true, cancelable: true });
  root.dispatchEvent(event);
  return event;
}

function pointerDown(root: HTMLElement, pointer: string) {
  // jsdom lacks PointerEvent. Supply its pointerType fact on a real event,
  // without replacing constructors or any editor behavior.
  const event = new MouseEvent('pointerdown', { bubbles: true });
  Object.defineProperty(event, 'pointerType', { value: pointer });
  root.dispatchEvent(event);
}

describe('restore focus boundary guards', () => {
  it.each([
    {
      name: 'mouse immediate',
      pointer: 'mouse',
      elapsed: null,
      restores: false,
    },
    { name: 'mouse next timer', pointer: 'mouse', elapsed: 0, restores: true },
    {
      name: 'touch before 500ms',
      pointer: 'touch',
      elapsed: 499,
      restores: false,
    },
    { name: 'touch at 500ms', pointer: 'touch', elapsed: 500, restores: true },
    { name: 'pen next timer', pointer: 'pen', elapsed: 0, restores: true },
  ])(
    'uses the $name pointer guard before restoring a root caret',
    ({ pointer, elapsed, restores }) => {
      const { editor, root } = focusFixture();
      pointerDown(root, pointer);
      if (elapsed !== null) vi.advanceTimersByTime(elapsed);
      expect(focusIn(root).defaultPrevented).toBe(restores);
      const caret = editor.read(() => {
        const selection = $getSelection();
        return $isRangeSelection(selection) ? selection.anchor.offset : null;
      });
      expect(caret).toBe(restores ? 4 : null);
    }
  );

  it('keeps real DOM focus on an embedded toolbar control instead of refocusing the editor', () => {
    const { editor, root } = focusFixture();
    editor.update(
      () => {
        $getRoot().append(
          $createListNode('check').append(
            $createListItemNode(false).append($createTextNode('Row'))
          )
        );
      },
      { discrete: true }
    );
    const bar = root.querySelector(`.${TASK_LIST_BAR_CLASS}`);
    if (!bar) throw new Error('Expected actual TaskList unmanaged mount');
    const control = document.createElement('button');
    control.textContent = 'Host control';
    bar.append(control);
    root.focus();
    const before = editor.read(() => $getSelection()?.clone());
    expect(document.activeElement).toBe(root);
    control.focus();
    const after = editor.read(() => $getSelection());
    expect(document.activeElement).toBe(control);
    expect(after?.is(before ?? null)).toBe(true);
  });

  it('does not restore or cancel focus events after disposal', () => {
    const { editor, root, dispose } = focusFixture();
    dispose();
    expect(focusIn(root).defaultPrevented).toBe(false);
    expect(editor.read(() => $getSelection())).toBeNull();
  });

  it('detaches pointer guards from the old root while restoring focus on its replacement', () => {
    const { editor, root } = focusFixture();
    const replacement = document.createElement('div');
    replacement.tabIndex = 0;
    replacement.contentEditable = 'true';
    document.body.append(replacement);
    try {
      editor.setRootElement(replacement);
      pointerDown(root, 'touch');
      expect(focusIn(replacement).defaultPrevented).toBe(true);
      expect(
        editor.read(() => {
          const selection = $getSelection();
          return $isRangeSelection(selection) ? selection.anchor.offset : null;
        })
      ).toBe(4);
    } finally {
      replacement.remove();
    }
  });
});
