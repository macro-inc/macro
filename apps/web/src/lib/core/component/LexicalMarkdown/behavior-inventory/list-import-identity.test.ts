import { ListNode } from '@lexical/list';
import {
  $createAwaitNode,
  type AwaitNode,
  TaskListNode,
} from '@macro-inc/lexical-core';
import {
  $createParagraphNode,
  $getRoot,
  $nodesOfType,
  $parseSerializedNode,
  createEditor,
} from 'lexical';
import { expect, test } from 'vitest';
import { createChecklistControls } from '../plugins/checklist-controls/checklistControlsPlugin';
import { $replaceAwaitNodeWithSnippet } from '../plugins/snippets/snippetInsertion';
import { setEditorStateFromMarkdown } from '../utils';
import { behaviorEditor } from './editor';

test('plain Markdown parser lists upgrade only in the live controls transform', () => {
  const controls = createChecklistControls();
  const { editor } = behaviorEditor(controls.plugin);
  // Match the real markdown-paste plugin's registry-only parsing editor.
  const parser = createEditor({
    namespace: 'paste-parser',
    editable: false,
    nodes: [...editor._nodes.values()].map((node) => node.klass),
  });
  setEditorStateFromMarkdown(
    parser,
    '# Head\n\n- a\n- b\n\n**bold** text',
    'both'
  );
  const parsed = parser.getEditorState().toJSON();
  expect(parsed.root.children[1].type).toBe('list');
  editor.update(
    () => {
      $getRoot().clear();
      for (const child of parsed.root.children)
        $getRoot().append($parseSerializedNode(child));
    },
    { discrete: true }
  );
  const actual = editor.getEditorState().toJSON();
  expect(actual.root.children[1]).toMatchObject({
    type: 'task-list',
    listType: 'bullet',
    tag: 'ul',
    children: [{ children: [{ text: 'a' }] }, { children: [{ text: 'b' }] }],
  });
});

test('the real snippet insertion upgrades its parsed numbered list in the controls-enabled body', () => {
  const controls = createChecklistControls();
  const { editor } = behaviorEditor(controls.plugin);
  const parser = createEditor({
    namespace: 'snippet-parser',
    editable: false,
    nodes: [...editor._nodes.values()].map((node) => node.klass),
  });
  let placeholder: AwaitNode | undefined;
  editor.update(
    () => {
      placeholder = $createAwaitNode({
        awaitId: 'snippet-fixture',
        inline: true,
      });
      $getRoot().append($createParagraphNode().append(placeholder));
    },
    { discrete: true }
  );
  setEditorStateFromMarkdown(parser, '4. item', 'both');
  const parsed = parser.getEditorState().toJSON();
  expect(parsed.root.children[0].type).toBe('list');
  const actualPlaceholder = placeholder;
  if (!actualPlaceholder) throw new Error('Missing actual snippet placeholder');
  editor.update(
    () => {
      $replaceAwaitNodeWithSnippet(
        actualPlaceholder,
        parsed.root.children.map((node) => $parseSerializedNode(node))
      );
    },
    { discrete: true }
  );
  const actual = editor.getEditorState().toJSON();
  expect(actual.root.children).toHaveLength(1);
  expect(actual.root.children[0]).toMatchObject({
    type: 'task-list',
    listType: 'number',
    tag: 'ol',
    start: 4,
    children: [{ children: [{ text: 'item' }] }],
  });
  editor.getEditorState().read(() => {
    expect($nodesOfType(TaskListNode)).toHaveLength(1);
    expect($nodesOfType(ListNode)).toHaveLength(0);
  });
});
