import { writeFileSync } from 'node:fs';
import {
  $createTableCellNode,
  $createTableNode,
  $createTableRowNode,
} from '@lexical/table';
import {
  $createUserMentionNode,
  UserMentionNode,
} from '@macro-inc/lexical-core';
import {
  $createNodeSelection,
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  $nodesOfType,
  $setSelection,
  type LexicalEditor,
} from 'lexical';
import { expect, test } from 'vitest';
import {
  INSERT_USER_MENTION_COMMAND,
  mentionsPlugin,
} from '../plugins/mentions/mentionsPlugin';
import { behaviorEditor } from './editor';

function capture(editor: LexicalEditor, name: string, handled: unknown) {
  const result = editor.read(() => {
    const selection = $getSelection();
    return {
      handled,
      json: editor.getEditorState().toJSON(),
      text: $getRoot().getTextContent(),
      mentions: $nodesOfType(UserMentionNode).map((node) => ({
        json: node.exportJSON(),
        parent: node.getParentOrThrow().getType(),
      })),
      selection: $isRangeSelection(selection)
        ? {
            anchor: {
              key: selection.anchor.key,
              offset: selection.anchor.offset,
              type: selection.anchor.type,
            },
            focus: {
              key: selection.focus.key,
              offset: selection.focus.offset,
              type: selection.focus.type,
            },
            format: selection.format,
            style: selection.style,
          }
        : null,
    };
  });
  if (process.env.SOURCE_USER_MENTION_OUTPUT) {
    writeFileSync(
      `${process.env.SOURCE_USER_MENTION_OUTPUT}/${name}.json`,
      JSON.stringify(result, null, 2)
    );
  }
  return result;
}

test.each([
  { name: 'missing', options: {}, expected: 'person' },
  { name: 'null', options: { displayName: null }, expected: 'person' },
  { name: 'empty', options: { displayName: '' }, expected: 'person' },
  {
    name: 'provided',
    options: { displayName: ' Given ', mentionUuid: 'issued-mention' },
    expected: ' Given ',
  },
  { name: 'null-uuid', options: { mentionUuid: null }, expected: 'person' },
  { name: 'empty-uuid', options: { mentionUuid: '' }, expected: 'person' },
])(
  'Source user constructor preserves $name options through the real command',
  ({ name, options, expected }) => {
    const { editor } = behaviorEditor(mentionsPlugin({}));
    editor.update(() => $getRoot().append($createParagraphNode()).selectEnd(), {
      discrete: true,
    });
    // Exercise the actual runtime command boundary, including explicit null that
    // the Source constructor handles although its TypeScript option omits it.
    const handled: unknown = Reflect.apply(editor.dispatchCommand, editor, [
      INSERT_USER_MENTION_COMMAND,
      { userId: 'fixture-user', email: 'person@example.com', ...options },
    ]);
    const result = capture(editor, `constructor-${name}`, handled);
    expect(handled).toBe(true);
    expect(result.mentions).toHaveLength(1);
    expect(result.mentions[0].json.displayName).toBe(expected);
    expect(result.mentions[0].parent).toBe('paragraph');
    expect(result.text).toBe(`@${expected}`);
    if ('mentionUuid' in options)
      expect(result.mentions[0].json.mentionUuid).toBe(options.mentionUuid);
    else expect(result.mentions[0].json.mentionUuid).toBeUndefined();
  }
);

test.each([
  'plain',
  'bold',
  'expanded',
  'node',
  'none',
  'root',
  'shadow',
  'code-format',
])(
  'Source insertion uses actual %s selection without a format gate',
  (mode) => {
    const { editor } = behaviorEditor(mentionsPlugin({}));
    editor.update(
      () => {
        const root = $getRoot();
        const text = $createTextNode('body');
        const paragraph = $createParagraphNode().append(text);
        root.append(paragraph);
        text.select(2, 2);
        if (mode === 'bold') {
          text.setFormat('bold');
          text.select(2, 2);
          const selection = $getSelection();
          if ($isRangeSelection(selection)) selection.format = 1;
        }
        if (mode === 'code-format') {
          text.setFormat('code');
          text.select(2, 2);
        }
        if (mode === 'expanded') text.select(1, 3);
        if (mode === 'none') $setSelection(null);
        if (mode === 'root') root.select(1, 1);
        if (mode === 'node') {
          const previous = $createUserMentionNode({
            userId: 'previous-user',
            email: 'previous@example.com',
          });
          paragraph.append(previous);
          const selection = $createNodeSelection();
          selection.add(previous.getKey());
          $setSelection(selection);
        }
        if (mode === 'shadow') {
          const cell = $createTableCellNode().append(
            $createParagraphNode().append($createTextNode('cell'))
          );
          root.append(
            $createTableNode().append($createTableRowNode().append(cell))
          );
          cell.getFirstDescendant()?.selectEnd();
        }
      },
      { discrete: true }
    );
    const handled = editor.dispatchCommand(INSERT_USER_MENTION_COMMAND, {
      userId: 'fixture-user',
      email: 'person@example.com',
      displayName: 'Person',
    });
    const result = capture(editor, `selection-${mode}`, handled);
    expect(handled).toBe(true);
    expect(
      result.mentions.filter(
        (mention) => mention.json.userId === 'fixture-user'
      )
    ).toHaveLength(1);
    expect(result.selection?.anchor).toEqual(result.selection?.focus);
  }
);
