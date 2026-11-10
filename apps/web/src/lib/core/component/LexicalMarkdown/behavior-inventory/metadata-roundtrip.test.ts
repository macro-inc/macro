import { $isListItemNode, $isListNode } from '@lexical/list';
import { $getRoot } from 'lexical';
import { expect, test } from 'vitest';
import { documentMetadataPlugin } from '../plugins/document-metadata/documentMetadataPlugin';
import { behaviorEditor } from './editor';

test('Source checklist save/reopen retains its authored versus imported metadata boundary', async () => {
  const { editor } = behaviorEditor(documentMetadataPlugin({}));
  editor.setEditorState(
    editor.parseEditorState(
      JSON.stringify({
        root: {
          type: 'root',
          version: 1,
          format: '',
          indent: 0,
          direction: null,
          children: [
            {
              type: 'list',
              version: 1,
              format: '',
              indent: 0,
              direction: null,
              listType: 'check',
              tag: 'ul',
              start: 1,
              children: [
                {
                  type: 'listitem',
                  version: 1,
                  format: '',
                  indent: 0,
                  direction: null,
                  checked: false,
                  value: 1,
                  children: [
                    {
                      type: 'text',
                      version: 1,
                      text: 'Retained check',
                      format: 0,
                      detail: 0,
                      style: '',
                      mode: 'normal',
                    },
                  ],
                },
              ],
            },
          ],
        },
      })
    )
  );
  await new Promise<void>((resolve) => queueMicrotask(resolve));
  editor.update(
    () => {
      const list = $getRoot().getFirstChild();
      if (!$isListNode(list))
        throw new Error('Missing actual Source checklist');
      const item = list.getFirstChild();
      if (!$isListItemNode(item))
        throw new Error('Missing actual Source checklist item');
      item.toggleChecked();
    },
    { discrete: true }
  );
  const saved = editor.getEditorState().toJSON();
  editor.setEditorState(editor.parseEditorState(saved));
  editor.read(() => {});
  const reopened = editor.getEditorState().toJSON();
  expect(saved.root.$?.documentMetadata).toEqual({ version: 10 });
  expect(reopened.root.$?.documentMetadata).toEqual({
    version: 10,
    environmentTags: null,
  });
});
