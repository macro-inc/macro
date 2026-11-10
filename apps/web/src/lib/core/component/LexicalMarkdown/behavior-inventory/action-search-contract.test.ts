import { $createCodeNode } from '@lexical/code';
import { InlineSearchNode } from '@macro-inc/lexical-core';
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  $nodesOfType,
} from 'lexical';
import { expect, test } from 'vitest';
import {
  actionsPlugin,
  CLOSE_ACTION_SEARCH_COMMAND,
  REMOVE_ACTION_SEARCH_COMMAND,
} from '../plugins/actions/actionsPlugin';
import { createMenuOperations } from '../shared/inlineMenu';
import { behaviorEditor } from './editor';

test.each([
  { text: '', offset: 0, code: false, opens: true },
  { text: 'word ', offset: 5, code: false, opens: true },
  { text: 'word', offset: 4, code: false, opens: false },
  { text: 'word', offset: 0, code: false, opens: false },
  { text: '`', offset: 1, code: false, opens: false },
  { text: ' ', offset: 1, code: true, opens: false },
  { text: '🐺 ', offset: 3, code: false, opens: true },
])('slash eligibility at $offset in $text (code=$code)', (value) => {
  const menu = createMenuOperations();
  const { editor, root } = behaviorEditor(actionsPlugin({ menu }));
  editor.update(
    () => {
      const parent = value.code ? $createCodeNode() : $createParagraphNode();
      $getRoot().append(parent);
      if (value.text) {
        const text = $createTextNode(value.text);
        parent.append(text);
        text.select(value.offset, value.offset);
      } else parent.selectStart();
    },
    { discrete: true }
  );
  root.dispatchEvent(new KeyboardEvent('keydown', { key: '/' }));
  editor.read(() => {
    expect($nodesOfType(InlineSearchNode)).toHaveLength(Number(value.opens));
  });
  expect(menu.isOpen()).toBe(value.opens);
});

test.each(['close', 'remove'] as const)(
  'slash %s preserves the Source text and caret policy',
  (mode) => {
    const menu = createMenuOperations();
    const { editor, root } = behaviorEditor(actionsPlugin({ menu }));
    editor.update(() => $getRoot().append($createParagraphNode()).selectEnd(), {
      discrete: true,
    });
    root.dispatchEvent(new KeyboardEvent('keydown', { key: '/' }));
    editor.read(() => expect($nodesOfType(InlineSearchNode)).toHaveLength(1));
    expect(menu.isOpen()).toBe(true);
    editor.update(
      () => {
        const search = $nodesOfType(InlineSearchNode)[0];
        search.setTextContent('/🐺term');
        search.selectEnd();
      },
      { discrete: true }
    );
    expect(menu.searchTerm()).toBe('🐺term');
    editor.update(
      () => {
        editor.dispatchCommand(
          mode === 'close'
            ? CLOSE_ACTION_SEARCH_COMMAND
            : REMOVE_ACTION_SEARCH_COMMAND,
          undefined
        );
      },
      { discrete: true }
    );
    editor.read(() => {
      expect($nodesOfType(InlineSearchNode)).toHaveLength(0);
      expect($getRoot().getTextContent()).toBe(
        mode === 'close' ? '/🐺term' : ''
      );
      const selection = $getSelection();
      expect($isRangeSelection(selection)).toBe(true);
      if (!$isRangeSelection(selection)) return;
      expect(selection.isCollapsed()).toBe(true);
      expect(selection.anchor.offset).toBe(mode === 'close' ? 7 : 0);
      expect(selection.anchor.type).toBe(mode === 'close' ? 'text' : 'element');
    });
    expect(menu.isOpen()).toBe(false);
  }
);
