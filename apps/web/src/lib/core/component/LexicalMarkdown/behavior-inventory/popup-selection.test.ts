import { isTouchDevice } from '@core/mobile/isTouchDevice';
import {
  $createTableNodeWithDimensions,
  $createTableSelection,
  $isTableCellNode,
  $isTableRowNode,
} from '@lexical/table';
import {
  $createNodeSelection,
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $setSelection,
  DELETE_CHARACTER_COMMAND,
  DELETE_LINE_COMMAND,
  DELETE_WORD_COMMAND,
  type LexicalCommand,
  type LexicalEditor,
  type RangeSelection,
  SELECTION_CHANGE_COMMAND,
} from 'lexical';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  HIGHLIGHT_SELECTED_NODES,
  POPUP_REPLACE_TEXT,
  popupPlugin,
  RECOMPUTE_SELECTION_RECT,
  REMOVE_HIGHLIGHT_SELECTED_NODES,
} from '../plugins/popup/popupPlugin';
import type { EnhancedSelection } from '../plugins/popup/types';
import { behaviorEditor } from './editor';

// Supply only the device capability. DOM ranges and editor nodes remain real.
vi.mock('@core/mobile/isTouchDevice', () => ({
  isTouchDevice: vi.fn(() => false),
}));

beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(isTouchDevice).mockReturnValue(false);
});
afterEach(() => {
  window.getSelection()?.removeAllRanges();
  vi.useRealTimers();
});

function dispatch<T>(
  editor: LexicalEditor,
  command: LexicalCommand<T>,
  payload: T
) {
  let handled = false;
  editor.update(
    () => {
      handled = editor.dispatchCommand(command, payload);
    },
    { discrete: true }
  );
  return handled;
}

function popupFixture(
  options: {
    collapsed?: boolean;
    allowEmpty?: (selection: RangeSelection) => boolean;
    accept?: boolean;
  } = {}
) {
  const visibility = vi.fn(
    (visible: boolean) => visible && options.accept !== false
  );
  const selection = vi.fn<(value: EnhancedSelection) => void>();
  let unregister: (() => void) | undefined;
  const dispose = () => {
    unregister?.();
    unregister = undefined;
  };
  const { editor, root } = behaviorEditor((editor) => {
    unregister = popupPlugin({
      setIsPopupVisible: visibility,
      setSelection: selection,
      $allowEmptySelection: options.allowEmpty,
    })(editor);
    return dispose;
  });
  editor.update(
    () => {
      const text = $createTextNode('Selected block');
      $getRoot().append(
        $createParagraphNode().append($createTextNode('Before')),
        $createParagraphNode().append(text),
        $createParagraphNode().append($createTextNode('After'))
      );
      text.select(0, options.collapsed ? 0 : 8);
    },
    { discrete: true }
  );
  const paragraph = root.querySelectorAll('p')[1];
  const text = paragraph.firstChild?.firstChild;
  if (!text) throw new Error('Expected mounted DOM text');
  const range = document.createRange();
  range.setStart(text, 0);
  range.setEnd(text, options.collapsed ? 0 : 8);
  // Only jsdom geometry is supplied, on the actual selected native range.
  range.getBoundingClientRect = () => new DOMRect(10, 20, 100, 30);
  const native = window.getSelection();
  if (!native) throw new Error('Expected native Selection');
  native.removeAllRanges();
  native.addRange(range);
  visibility.mockClear();
  selection.mockClear();
  return { editor, root, paragraph, visibility, selection, native, dispose };
}

describe('selection popup controller', () => {
  it('publishes selected text and full root-block Markdown from a real range', () => {
    const { editor, selection } = popupFixture();
    expect(dispatch(editor, SELECTION_CHANGE_COMMAND, undefined)).toBe(true);
    expect(selection).toHaveBeenLastCalledWith(
      expect.objectContaining({
        type: 'range',
        text: 'Selected',
        nodeText: 'Selected block\n\n\n\n',
        rect: expect.objectContaining({ x: 10, y: 20, width: 100, height: 30 }),
      })
    );
  });

  it('hides and yields when the model selection is absent', () => {
    const { editor, visibility, selection } = popupFixture();
    editor.update(() => $setSelection(null), { discrete: true });
    selection.mockClear();
    expect(dispatch(editor, SELECTION_CHANGE_COMMAND, undefined)).toBe(false);
    expect(visibility).toHaveBeenLastCalledWith(false);
    expect(selection).not.toHaveBeenCalled();
  });

  it('does not show a collapsed range without the host exception', () => {
    const { editor, selection } = popupFixture({ collapsed: true });
    expect(dispatch(editor, SELECTION_CHANGE_COMMAND, undefined)).toBe(false);
    expect(selection).not.toHaveBeenCalled();
  });

  it('does not consult the empty-range exception for nonempty text', () => {
    const exception = vi.fn(() => false);
    const { editor, selection } = popupFixture({ allowEmpty: exception });
    expect(dispatch(editor, SELECTION_CHANGE_COMMAND, undefined)).toBe(true);
    expect(exception).not.toHaveBeenCalled();
    expect(selection).toHaveBeenLastCalledWith(
      expect.objectContaining({ text: 'Selected' })
    );
  });

  it.each([false, true])('uses the host empty-range exception=%s', (allow) => {
    const exception = vi.fn(() => allow);
    const { editor, selection } = popupFixture({
      collapsed: true,
      allowEmpty: exception,
    });
    expect(dispatch(editor, SELECTION_CHANGE_COMMAND, undefined)).toBe(allow);
    expect(exception).toHaveBeenCalled();
    if (allow)
      expect(selection).toHaveBeenLastCalledWith(
        expect.objectContaining({ type: 'range', text: '' })
      );
    else expect(selection).not.toHaveBeenCalled();
  });

  it('yields when the real DOM selection has no range', () => {
    const { editor, native, selection } = popupFixture();
    native.removeAllRanges();
    expect(dispatch(editor, SELECTION_CHANGE_COMMAND, undefined)).toBe(false);
    expect(selection).not.toHaveBeenCalled();
  });

  it('does not cache a selection rejected by the host visibility setter', () => {
    const { editor, selection, visibility } = popupFixture({ accept: false });
    expect(dispatch(editor, SELECTION_CHANGE_COMMAND, undefined)).toBe(false);
    expect(visibility.mock.calls).toEqual([[false], [true]]);
    expect(dispatch(editor, RECOMPUTE_SELECTION_RECT, undefined)).toBe(true);
    expect(selection).not.toHaveBeenCalled();
  });

  it('recomputes live geometry but falls back to the original cached rectangle when native selection clears', () => {
    const { editor, selection, native } = popupFixture();
    dispatch(editor, SELECTION_CHANGE_COMMAND, undefined);
    native.getRangeAt(0).getBoundingClientRect = () =>
      new DOMRect(30, 40, 70, 20);
    dispatch(editor, RECOMPUTE_SELECTION_RECT, undefined);
    expect(selection).toHaveBeenLastCalledWith(
      expect.objectContaining({
        rect: expect.objectContaining({ x: 30, y: 40, width: 70, height: 20 }),
        text: 'Selected',
      })
    );
    native.removeAllRanges();
    dispatch(editor, RECOMPUTE_SELECTION_RECT, undefined);
    expect(selection).toHaveBeenLastCalledWith(
      expect.objectContaining({
        rect: expect.objectContaining({ x: 10, y: 20, width: 100, height: 30 }),
        text: 'Selected',
      })
    );
  });

  it('clears the cached popup selection when the model selection disappears', () => {
    const { editor, selection } = popupFixture();
    dispatch(editor, SELECTION_CHANGE_COMMAND, undefined);
    editor.update(() => $setSelection(null), { discrete: true });
    expect(dispatch(editor, SELECTION_CHANGE_COMMAND, undefined)).toBe(false);
    selection.mockClear();
    dispatch(editor, RECOMPUTE_SELECTION_RECT, undefined);
    expect(selection).not.toHaveBeenCalled();
  });

  it('yields for a real node selection instead of treating it as text', () => {
    const { editor, selection } = popupFixture();
    editor.update(
      () => {
        const nodeSelection = $createNodeSelection();
        const node = $getRoot().getChildAtIndex(1);
        if (!node) throw new Error('Expected selected paragraph');
        nodeSelection.add(node.getKey());
        $setSelection(nodeSelection);
      },
      { discrete: true }
    );
    selection.mockClear();
    expect(dispatch(editor, SELECTION_CHANGE_COMMAND, undefined)).toBe(false);
    expect(selection).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    'accepts empty desktop table cells but suppresses the popup on primary touch=%s',
    (touch) => {
      const { editor, selection } = popupFixture();
      const cellKeys: string[] = [];
      editor.update(
        () => {
          const table = $createTableNodeWithDimensions(2, 2, false);
          $getRoot().clear().append(table);
          for (const row of table.getChildren()) {
            if (!$isTableRowNode(row)) throw new Error('Expected table row');
            for (const cell of row.getChildren()) {
              if (!$isTableCellNode(cell))
                throw new Error('Expected table cell');
              cellKeys.push(cell.getKey());
            }
          }
          const tableSelection = $createTableSelection();
          tableSelection.set(table.getKey(), cellKeys[0], cellKeys[3]);
          $setSelection(tableSelection);
        },
        { discrete: true }
      );
      cellKeys.forEach((key, index) => {
        const element = editor.getElementByKey(key);
        if (!element) throw new Error('Expected mounted cell');
        element.getBoundingClientRect = () =>
          new DOMRect(
            10 + (index % 2) * 80,
            20 + Math.floor(index / 2) * 30,
            80,
            30
          );
      });
      vi.mocked(isTouchDevice).mockReturnValue(touch);
      selection.mockClear();
      expect(dispatch(editor, SELECTION_CHANGE_COMMAND, undefined)).toBe(
        !touch
      );
      if (touch) expect(selection).not.toHaveBeenCalled();
      else {
        const result = selection.mock.lastCall?.[0];
        expect(result?.type).toBe('table');
        expect(result?.text.trim()).toBe('');
        expect(result?.nodeText).toBe('');
        expect(result?.rect).toMatchObject({
          x: 10,
          y: 20,
          width: 160,
          height: 60,
        });
        const firstCell = editor.getElementByKey(cellKeys[0]);
        const lastCell = editor.getElementByKey(cellKeys[3]);
        if (!firstCell || !lastCell)
          throw new Error('Expected mounted boundary cells');
        firstCell.getBoundingClientRect = () => new DOMRect(20, 30, 80, 30);
        lastCell.getBoundingClientRect = () => new DOMRect(100, 70, 100, 50);
        dispatch(editor, RECOMPUTE_SELECTION_RECT, undefined);
        expect(selection.mock.lastCall?.[0].rect).toMatchObject({
          x: 20,
          y: 30,
          width: 180,
          height: 90,
        });
      }
      const saved = JSON.stringify(editor.getEditorState().toJSON());
      expect(
        dispatch(editor, POPUP_REPLACE_TEXT, '**Ignored table replacement**')
      ).toBe(true);
      expect(JSON.stringify(editor.getEditorState().toJSON())).toBe(saved);
    }
  );

  it.each([
    { name: 'character', command: DELETE_CHARACTER_COMMAND },
    { name: 'word', command: DELETE_WORD_COMMAND },
    { name: 'line', command: DELETE_LINE_COMMAND },
  ])(
    'hides on $name deletion while yielding the deletion command',
    ({ command }) => {
      const { editor, visibility } = popupFixture();
      dispatch(editor, SELECTION_CHANGE_COMMAND, undefined);
      visibility.mockClear();
      expect(dispatch(editor, command, true)).toBe(false);
      expect(visibility).toHaveBeenLastCalledWith(false);
    }
  );

  it('highlights selected root blocks and removes only the highlight after its delay', () => {
    const { editor, root, paragraph } = popupFixture();
    paragraph.classList.add('host-class');
    expect(dispatch(editor, HIGHLIGHT_SELECTED_NODES, undefined)).toBe(true);
    expect(root.querySelectorAll('.md-highlight-selected-nodes')).toHaveLength(
      1
    );
    expect(paragraph.classList.contains('md-highlight-selected-nodes')).toBe(
      true
    );
    dispatch(editor, REMOVE_HIGHLIGHT_SELECTED_NODES, undefined);
    vi.advanceTimersByTime(99);
    expect(paragraph.classList.contains('md-highlight-selected-nodes')).toBe(
      true
    );
    vi.advanceTimersByTime(1);
    expect(paragraph.classList.contains('md-highlight-selected-nodes')).toBe(
      false
    );
    expect(paragraph.classList.contains('host-class')).toBe(true);
  });

  it('replaces the full partially selected block with parsed Markdown and preserves its neighbors', () => {
    const { editor, root } = popupFixture();
    expect(dispatch(editor, POPUP_REPLACE_TEXT, '**Replacement**')).toBe(true);
    expect(
      editor.read(() =>
        $getRoot()
          .getChildren()
          .map((node) => node.getTextContent())
      )
    ).toEqual(['Before', 'Replacement', 'After']);
    const replacement = root.querySelectorAll('p')[1];
    expect(replacement.querySelector('strong, b')).not.toBeNull();
    vi.advanceTimersByTime(0);
    expect(
      replacement.classList.contains(
        'md-highlight-replaced-nodes-background-color'
      )
    ).toBe(true);
    vi.advanceTimersByTime(1700);
    expect(
      replacement.classList.contains(
        'md-highlight-replaced-nodes-background-color'
      )
    ).toBe(false);
    expect(replacement.style.transition).toBe('background-color 1.3s ease');
    vi.advanceTimersByTime(1400);
    expect(replacement.style.transition).toBe('none');
  });

  it('handles replacement without mutation when no model selection exists', () => {
    const { editor } = popupFixture();
    editor.update(() => $setSelection(null), { discrete: true });
    const saved = JSON.stringify(editor.getEditorState().toJSON());
    expect(
      dispatch(editor, POPUP_REPLACE_TEXT, '**Ignored replacement**')
    ).toBe(true);
    vi.runOnlyPendingTimers();
    expect(JSON.stringify(editor.getEditorState().toJSON())).toBe(saved);
  });

  it('unregisters popup selection, geometry, highlight and replacement commands on disposal', () => {
    const { editor, root, dispose, visibility, selection } = popupFixture();
    dispose();
    visibility.mockClear();
    selection.mockClear();
    const saved = JSON.stringify(editor.getEditorState().toJSON());
    expect(dispatch(editor, SELECTION_CHANGE_COMMAND, undefined)).toBe(false);
    expect(dispatch(editor, RECOMPUTE_SELECTION_RECT, undefined)).toBe(false);
    expect(dispatch(editor, HIGHLIGHT_SELECTED_NODES, undefined)).toBe(false);
    expect(dispatch(editor, REMOVE_HIGHLIGHT_SELECTED_NODES, undefined)).toBe(
      false
    );
    expect(
      dispatch(editor, POPUP_REPLACE_TEXT, '**Ignored after dispose**')
    ).toBe(false);
    expect(dispatch(editor, DELETE_CHARACTER_COMMAND, true)).toBe(false);
    expect(root.querySelectorAll('.md-highlight-selected-nodes')).toHaveLength(
      0
    );
    expect(JSON.stringify(editor.getEditorState().toJSON())).toBe(saved);
    expect(visibility).not.toHaveBeenCalled();
    expect(selection).not.toHaveBeenCalled();
  });
});
