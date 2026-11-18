import { writeFileSync } from 'node:fs';
import { DateMentionNode } from '@macro-inc/lexical-core';
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  $nodesOfType,
} from 'lexical';
import { afterAll, expect, test } from 'vitest';
import {
  INSERT_DATE_MENTION_COMMAND,
  mentionsPlugin,
} from '../plugins/mentions/mentionsPlugin';
import { behaviorEditor } from './editor';

const captures: unknown[] = [];
afterAll(() => {
  if (process.env.SOURCE_DATE_TYPING_OUTPUT)
    writeFileSync(
      process.env.SOURCE_DATE_TYPING_OUTPUT,
      JSON.stringify(captures, null, 2)
    );
});

test.each([
  { format: 'bold' as const, mask: 1 },
  { format: 'code' as const, mask: 16 },
])(
  'actual Source Date insertion retains $format typing state',
  ({ format, mask }) => {
    const { editor } = behaviorEditor(mentionsPlugin({}));
    editor.update(
      () => {
        const text = $createTextNode('body').toggleFormat(format);
        $getRoot().append($createParagraphNode().append(text));
        const selection = text.select(2, 2);
        selection.format = mask;
      },
      { discrete: true }
    );
    const before = editor.read(() => {
      const selection = $getSelection();
      return {
        json: editor.getEditorState().toJSON(),
        selectionFormat: $isRangeSelection(selection) ? selection.format : null,
      };
    });
    expect(before.selectionFormat).toBe(mask);
    const handled = editor.dispatchCommand(INSERT_DATE_MENTION_COMMAND, {
      date: '2026-06-15T12:00:00.000Z',
      displayFormat: 'Today',
    });
    const after = editor.read(() => {
      const selection = $getSelection();
      return {
        json: editor.getEditorState().toJSON(),
        text: $getRoot().getTextContent(),
        dates: $nodesOfType(DateMentionNode).map((node) => node.exportJSON()),
        selection: $isRangeSelection(selection)
          ? {
              anchor: {
                key: selection.anchor.key,
                type: selection.anchor.type,
                offset: selection.anchor.offset,
              },
              focus: {
                key: selection.focus.key,
                type: selection.focus.type,
                offset: selection.focus.offset,
              },
              format: selection.format,
              style: selection.style,
            }
          : null,
      };
    });
    expect(handled).toBe(true);
    expect(after.dates).toHaveLength(1);
    expect(after.text).toBe('boTodaydy');
    expect(after.selection).toMatchObject({
      anchor: { type: 'text', offset: 0 },
      format: mask,
    });
    expect(after.selection?.anchor).toEqual(after.selection?.focus);
    captures.push({ format, before, handled, after });
  }
);
