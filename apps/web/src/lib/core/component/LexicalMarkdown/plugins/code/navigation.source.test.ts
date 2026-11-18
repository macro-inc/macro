import { CodeHighlightNode, CodeNode } from '@lexical/code';
import {
  $getRoot,
  $getSelection,
  $isRangeSelection,
  createEditor,
  KEY_DOWN_COMMAND,
} from 'lexical';
import { createStore } from 'solid-js/store';
import { expect, test, vi } from 'vitest';
import type { AccessoryStore } from '../node-accessory';

vi.mock('@lexical/code', async (original) => ({
  ...(await original<typeof import('@lexical/code')>()),
  registerCodeHighlighting: () => () => {},
}));
vi.mock('../../component/accessory/CodeBoxAccessory', () => ({
  CodeBoxAccessory: () => null,
}));
vi.mock('../node-accessory', () => ({
  nodeAccessoryPlugin: () => () => () => {},
}));

import { codePlugin } from './codePlugin';

test('source arrow-up preserves the captured highlight point after inserting a leading paragraph', async () => {
  const editor = createEditor({
    nodes: [CodeNode, CodeHighlightNode],
    onError(error) {
      throw error;
    },
  });
  const [accessories, setAccessories] = createStore<AccessoryStore>({});
  const release = codePlugin({ accessories, setAccessories })(editor);
  try {
    editor.setEditorState(
      editor.parseEditorState(
        JSON.stringify({
          root: {
            type: 'root',
            version: 1,
            children: [
              {
                type: 'code',
                version: 1,
                children: [
                  { type: 'code-highlight', version: 1, text: 'first' },
                ],
              },
            ],
          },
        })
      )
    );
    editor.update(
      () => {
        $getRoot().getFirstChildOrThrow().selectStart();
      },
      { discrete: true }
    );
    const queued: (() => void)[] = [];
    const scheduler = vi
      .spyOn(globalThis, 'queueMicrotask')
      .mockImplementation((callback) => queued.push(callback));
    editor.update(
      () => {
        expect(
          editor.dispatchCommand(
            KEY_DOWN_COMMAND,
            new KeyboardEvent('keydown', { key: 'ArrowUp' })
          )
        ).toBe(true);
      },
      { discrete: true }
    );
    scheduler.mockRestore();
    let releaseUpdate = () => {};
    const completion = new Promise<void>((resolve) => {
      releaseUpdate = editor.registerUpdateListener(() => resolve());
    });
    for (const callback of queued) callback();
    await completion;
    releaseUpdate();
    editor.getEditorState().read(() => {
      const blocks = $getRoot().getChildren();
      expect(blocks.map((node) => node.getType())).toEqual([
        'paragraph',
        'code',
      ]);
      const selection = $getSelection();
      expect($isRangeSelection(selection) && selection.anchor.key).toBe(
        blocks[1]?.getKey()
      );
      expect($isRangeSelection(selection) && selection.anchor.offset).toBe(0);
    });
  } finally {
    vi.restoreAllMocks();
    release();
  }
});
