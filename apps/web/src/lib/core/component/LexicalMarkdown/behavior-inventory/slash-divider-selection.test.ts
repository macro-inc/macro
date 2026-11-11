import { writeFileSync } from 'node:fs';
import { $createListItemNode, $createListNode } from '@lexical/list';
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $getSelection,
  $isElementNode,
  $isRangeSelection,
  type LexicalNode,
} from 'lexical';
import { expect, test } from 'vitest';
import {
  horizontalRulePlugin,
  INSERT_HORIZONTAL_RULE_COMMAND,
} from '../plugins/horizontal-rules/horizontalRulePlugin';
import { behaviorEditor } from './editor';

const captures: unknown[] = [];
for (const kind of ['empty', 'bullet', 'number', 'check'] as const) {
  test(`divider retains the Source caret for ${kind}`, () => {
    const { editor } = behaviorEditor(horizontalRulePlugin());
    editor.update(
      () => {
        if (kind === 'empty') {
          $getRoot().append($createParagraphNode()).selectEnd();
        } else {
          const text = $createTextNode('before');
          $getRoot().append(
            $createListNode(kind).append(
              $createListItemNode().append(text),
              $createListItemNode().append($createTextNode('after'))
            )
          );
          text.selectEnd();
        }
        expect(
          editor.dispatchCommand(INSERT_HORIZONTAL_RULE_COMMAND, undefined)
        ).toBe(true);
      },
      { discrete: true }
    );
    editor.read(() => {
      const paths = new Map<string, number[]>();
      const walk = (node: LexicalNode, path: number[]) => {
        paths.set(node.getKey(), path);
        if ($isElementNode(node))
          node
            .getChildren()
            .forEach((child, index) => walk(child, [...path, index]));
      };
      walk($getRoot(), []);
      const selection = $getSelection();
      if (!$isRangeSelection(selection))
        throw new Error('Missing Source range');
      const point = (value: typeof selection.anchor) => ({
        path: paths.get(value.key),
        offset: value.offset,
        type: value.type,
      });
      captures.push({
        kind,
        model: editor.getEditorState().toJSON(),
        selection: {
          anchor: point(selection.anchor),
          focus: point(selection.focus),
        },
      });
      const expected = {
        path: kind === 'empty' ? [1] : [2, 0],
        offset: 0,
        type: 'element',
      };
      expect(point(selection.anchor)).toEqual(expected);
      expect(point(selection.focus)).toEqual(expected);
      expect(selection.isCollapsed()).toBe(true);
    });
    const output = process.env.NATIVE_SLASH_SOURCE_CAPTURE;
    if (output) writeFileSync(output, JSON.stringify(captures, null, 2));
  });
}
