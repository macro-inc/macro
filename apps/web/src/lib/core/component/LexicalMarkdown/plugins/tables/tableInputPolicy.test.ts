import {
  NodeReplacements,
  SupportedNodeTypes,
} from '@macro-inc/lexical-core/node-list';
import {
  $getSelection,
  createEditor,
  INDENT_CONTENT_COMMAND,
  KEY_TAB_COMMAND,
} from 'lexical';
import { expect, it } from 'vitest';
import { registerTableListTab } from './tableListTab';
import { $createListCell, buildTable, placeCaret } from './tableTestUtils';

it('eligible table list Tab consumes without a nested indent handler', async () => {
  const editor = createEditor({
    namespace: 'table-list-tab-policy',
    nodes: [...SupportedNodeTypes, ...NodeReplacements],
    onError: (error) => {
      throw error;
    },
  });
  const root = document.createElement('div');
  document.body.appendChild(root);
  editor.setRootElement(root);
  const unregister = registerTableListTab(editor);
  try {
    await buildTable(editor, [[() => $createListCell(['keep'])]]);
    await placeCaret(editor, 'keep');
    const before = editor.getEditorState().toJSON();
    const selection = editor
      .getEditorState()
      .read(() => $getSelection()?.clone() ?? null);
    let handled = false;
    const event = new KeyboardEvent('keydown', {
      key: 'Tab',
      cancelable: true,
    });
    editor.update(
      () => {
        expect(editor.dispatchCommand(INDENT_CONTENT_COMMAND, undefined)).toBe(
          false
        );
        handled = editor.dispatchCommand(KEY_TAB_COMMAND, event);
      },
      { discrete: true }
    );
    expect(handled).toBe(true);
    expect(event.defaultPrevented).toBe(true);
    expect(editor.getEditorState().toJSON()).toEqual(before);
    expect(
      editor.getEditorState().read(() => $getSelection()?.is(selection))
    ).toBe(true);
  } finally {
    unregister();
    editor.setRootElement(null);
    root.remove();
  }
});
