import { expect, test, vi } from 'vitest';
import {
  $getRoot,
  createEditor,
  getActiveEditor,
  isCurrentlyReadOnlyMode,
} from '../editor';
import { ParagraphNode, RootNode, TextNode } from '../nodes';

test('state JSON invokes actual JS hooks in its owning readonly scope and restores nesting', () => {
  const editor = createEditor();
  const nested = createEditor();
  const exportRoot = RootNode.prototype.exportJSON;
  const calls: unknown[] = [];
  const hook = vi
    .spyOn(RootNode.prototype, 'exportJSON')
    .mockImplementation(function (this: RootNode) {
      calls.push(getActiveEditor(), isCurrentlyReadOnlyMode());
      return { ...exportRoot.call(this), version: 7 };
    });
  try {
    editor.update(
      () => {
        $getRoot().append(
          new ParagraphNode().append(new TextNode('JS export'))
        );
      },
      { discrete: true }
    );
    const state = editor.getEditorState();
    nested.read(() => {
      expect(getActiveEditor()).toBe(nested);
      const json = state.toJSON();
      expect(json).toMatchObject({
        root: {
          version: 7,
          children: [
            {
              type: 'paragraph',
              children: [{ type: 'text', text: 'JS export' }],
            },
          ],
        },
      });
      expect(getActiveEditor()).toBe(nested);
      expect(isCurrentlyReadOnlyMode()).toBe(true);
    });
    expect(calls).toEqual([editor, true]);
    expect(() => getActiveEditor()).toThrow('Unable to find an active editor');
    expect(isCurrentlyReadOnlyMode()).toBe(false);
  } finally {
    hook.mockRestore();
    nested.dispose();
    editor.dispose();
  }
});

test('state JSON preserves opaque JS export errors and restores the surrounding scope', () => {
  const editor = createEditor();
  const nested = createEditor();
  const failure = { reason: 'export hook' };
  const hook = vi
    .spyOn(RootNode.prototype, 'exportJSON')
    .mockImplementation(() => {
      expect(getActiveEditor()).toBe(editor);
      expect(isCurrentlyReadOnlyMode()).toBe(true);
      throw failure;
    });
  try {
    nested.read(() => {
      expect(() => editor.getEditorState().toJSON()).toThrow(failure);
      expect(getActiveEditor()).toBe(nested);
      expect(isCurrentlyReadOnlyMode()).toBe(true);
    });
    expect(() => getActiveEditor()).toThrow('Unable to find an active editor');
    expect(isCurrentlyReadOnlyMode()).toBe(false);
  } finally {
    hook.mockRestore();
    nested.dispose();
    editor.dispose();
  }
});

test('saved initial state stays readable and exports its own empty graph after updates', () => {
  const editor = createEditor();
  try {
    const initial = editor.getEditorState();
    editor.update(
      () => {
        $getRoot().append(new ParagraphNode().append(new TextNode('later')));
      },
      { discrete: true }
    );
    editor.update(
      () => {
        $getRoot().append(new ParagraphNode().append(new TextNode('latest')));
      },
      { discrete: true }
    );
    expect(initial.read(() => $getRoot().getChildrenSize())).toBe(0);
    expect(initial.toJSON().root.children).toEqual([]);
    expect(editor.getEditorState().toJSON().root.children).toHaveLength(2);
  } finally {
    editor.dispose();
  }
});
