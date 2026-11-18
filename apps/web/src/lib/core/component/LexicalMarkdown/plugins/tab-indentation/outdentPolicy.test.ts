import { $createListItemNode, $createListNode } from '@lexical/list';
import {
  $createHeadingNode,
  $createQuoteNode,
  registerRichText,
} from '@lexical/rich-text';
import {
  $createNodeSelection,
  $createParagraphNode,
  $createRangeSelection,
  $createTextNode,
  $getRoot,
  $getSelection,
  $setSelection,
  KEY_TAB_COMMAND,
  OUTDENT_CONTENT_COMMAND,
} from 'lexical';
import { expect, it } from 'vitest';
import { behaviorEditor } from '../../behavior-inventory/editor';
import { tabIndentationPlugin } from './tabIndentationPlugin';

it('ordinary Outdent and Shift+Tab move a plain list item one level and clamp at zero', () => {
  const { editor } = behaviorEditor(registerRichText, tabIndentationPlugin());
  editor.update(
    () => {
      const list = $createListNode('bullet');
      const first = $createListItemNode().append($createTextNode('one'));
      const text = $createTextNode('two');
      const item = $createListItemNode().append(text);
      list.append(first, item);
      $getRoot().append(list);
      item.setIndent(2);
      text.select(0, 0);
      const selection = $getSelection()?.clone() ?? null;
      const event = new KeyboardEvent('keydown', {
        key: 'Tab',
        shiftKey: true,
        cancelable: true,
      });
      expect(editor.dispatchCommand(KEY_TAB_COMMAND, event)).toBe(true);
      expect(event.defaultPrevented).toBe(true);
      expect(item.getIndent()).toBe(1);
      for (const expected of [0, 0]) {
        expect(editor.dispatchCommand(OUTDENT_CONTENT_COMMAND, undefined)).toBe(
          true
        );
        expect(item.getIndent()).toBe(expected);
        expect(item.getTextContent()).toBe('two');
        expect($getSelection()?.is(selection)).toBe(true);
      }
    },
    { discrete: true }
  );
});

it('expanded Outdent changes each paragraph once and handles zero indent', () => {
  const { editor } = behaviorEditor(registerRichText);
  editor.update(
    () => {
      const one = $createTextNode('one');
      const two = $createTextNode('two');
      const first = $createParagraphNode().append(one).setIndent(3);
      const second = $createParagraphNode().append(two).setIndent(1);
      $getRoot().append(first, second);
      const selection = $createRangeSelection();
      selection.anchor.set(one.getKey(), 0, 'text');
      selection.focus.set(two.getKey(), 3, 'text');
      $setSelection(selection);
      for (const expected of [
        [2, 0],
        [1, 0],
        [0, 0],
        [0, 0],
      ]) {
        expect(editor.dispatchCommand(OUTDENT_CONTENT_COMMAND, undefined)).toBe(
          true
        );
        expect([first.getIndent(), second.getIndent()]).toEqual(expected);
      }
    },
    { discrete: true }
  );
});

it.each([
  { kind: 'quote', create: $createQuoteNode },
  { kind: 'heading', create: () => $createHeadingNode('h2') },
])('ordinary Outdent still reduces $kind indentation', ({ create }) => {
  const { editor } = behaviorEditor(registerRichText);
  editor.update(
    () => {
      const text = $createTextNode('keep');
      const block = create().append(text).setIndent(2);
      $getRoot().append(block);
      text.select(0, 0);
      expect(editor.dispatchCommand(OUTDENT_CONTENT_COMMAND, undefined)).toBe(
        true
      );
      expect(block.getIndent()).toBe(1);
    },
    { discrete: true }
  );
});

it('ordinary Outdent yields for null and node selection', () => {
  const { editor } = behaviorEditor(registerRichText);
  editor.update(
    () => {
      const block = $createParagraphNode()
        .append($createTextNode('keep'))
        .setIndent(2);
      $getRoot().append(block);
      $setSelection(null);
      expect(editor.dispatchCommand(OUTDENT_CONTENT_COMMAND, undefined)).toBe(
        false
      );
      const selection = $createNodeSelection();
      selection.add(block.getKey());
      $setSelection(selection);
      expect(editor.dispatchCommand(OUTDENT_CONTENT_COMMAND, undefined)).toBe(
        false
      );
      expect(block.getIndent()).toBe(2);
    },
    { discrete: true }
  );
});
