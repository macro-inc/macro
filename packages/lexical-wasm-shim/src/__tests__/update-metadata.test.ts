import { expect, test } from 'vitest';
import { isHostUpdateMetadata } from '../backend/update-metadata';
import { createEditor, isCurrentlyReadOnlyMode } from '../editor';
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  LexicalNode,
  TextNode,
} from '../index';
import type { ParagraphNode } from '../nodes';

test('native dirty intent stays live across historical readonly peers and restores after throws', () => {
  const editor = createEditor();
  let text: TextNode | undefined;
  let paragraph: ParagraphNode | undefined;
  try {
    editor.update(
      () => {
        const leaves = editor._dirtyLeaves;
        const elements = editor._dirtyElements;
        text = $createTextNode('before');
        paragraph = $createParagraphNode().append(text);
        $getRoot().append(paragraph);
        expect(leaves.has(text.getKey())).toBe(true);
        expect(elements.get(paragraph.getKey())).toBe(true);
        expect(text.isDirty()).toBe(true);
        expect(paragraph.isDirty()).toBe(true);
        expect(LexicalNode.prototype.isDirty.call(paragraph)).toBe(false);
        expect(editor._dirtyLeaves.has(text.getKey())).toBe(true);
        expect(editor._dirtyElements.get(paragraph.getKey())).toBe(true);
        expect(editor._dirtyType).toBe(1);
      },
      { discrete: true }
    );
    const before = editor.getEditorState();
    expect(editor._dirtyType).toBe(0);
    editor.update(
      () => {
        if (text === undefined || paragraph === undefined)
          throw new Error('Missing native graph');
        const leaves = editor._dirtyLeaves;
        const elements = editor._dirtyElements;
        text.setTextContent('after');
        expect(leaves.has(text.getKey())).toBe(true);
        expect(elements.get(paragraph.getKey())).toBe(false);
        expect(editor._dirtyLeaves.has(text.getKey())).toBe(true);
        expect(editor._dirtyElements.get(paragraph.getKey())).toBe(false);
        const textKey = text.getKey();
        const paragraphKey = paragraph.getKey();
        const failure = new Error('owned read');
        expect(() =>
          before.read(
            () => {
              expect(isCurrentlyReadOnlyMode()).toBe(true);
              expect(editor._dirtyLeaves.has(textKey)).toBe(true);
              expect($getRoot().getTextContent()).toBe('before');
              before.read(
                () => {
                  expect(editor._dirtyElements.get(paragraphKey)).toBe(false);
                  expect($getRoot().__cachedText).toBe(null);
                },
                { editor }
              );
              throw failure;
            },
            { editor }
          )
        ).toThrow(failure);
        expect(isCurrentlyReadOnlyMode()).toBe(false);
        expect($getRoot().getTextContent()).toBe('after');
        expect(editor._dirtyType).toBe(1);
      },
      { discrete: true }
    );
    expect(editor._dirtyLeaves.size).toBe(0);
    expect(editor._dirtyElements.size).toBe(0);
    before.read(() => expect($getRoot().getTextContent()).toBe('before'), {
      editor,
    });
    editor.read(() => expect($getRoot().getTextContent()).toBe('after'));
  } finally {
    editor.dispose();
  }
});

test('generated metadata validation rejects unknown types and malformed intentions', () => {
  expect(
    isHostUpdateMetadata({
      dirty_type: 2,
      dirty_leaves: [],
      dirty_elements: [['root', false]],
    })
  ).toBe(true);
  expect(
    isHostUpdateMetadata({
      dirty_type: 3,
      dirty_leaves: [],
      dirty_elements: [],
    })
  ).toBe(false);
  expect(
    isHostUpdateMetadata({
      dirty_type: NaN,
      dirty_leaves: [],
      dirty_elements: [],
    })
  ).toBe(false);
  expect(
    isHostUpdateMetadata({
      dirty_type: 1,
      dirty_leaves: [0],
      dirty_elements: [],
    })
  ).toBe(false);
  expect(
    isHostUpdateMetadata({
      dirty_type: 1,
      dirty_leaves: [],
      dirty_elements: [['root', 0]],
    })
  ).toBe(false);
});

test('transform registration refreshes retained dirty collections before callbacks', () => {
  const editor = createEditor();
  let text: TextNode | undefined;
  let paragraph: ParagraphNode | undefined;
  let unregister: (() => void) | undefined;
  try {
    editor.update(
      () => {
        text = $createTextNode('before');
        paragraph = $createParagraphNode().append(text);
        $getRoot().append(paragraph);
      },
      { discrete: true }
    );
    editor.update(
      () => {
        if (!text || !paragraph) throw new Error('Missing native graph');
        const leaves = editor._dirtyLeaves;
        const elements = editor._dirtyElements;
        expect(leaves.has(text.getKey())).toBe(false);
        unregister = editor.registerNodeTransform(TextNode, (node) => {
          expect(leaves.has(node.getKey())).toBe(true);
          if (!paragraph) throw new Error('Missing native paragraph');
          expect(elements.has(paragraph.getKey())).toBe(true);
        });
        expect(leaves.has(text.getKey())).toBe(true);
        expect(elements.has(paragraph.getKey())).toBe(true);
      },
      { discrete: true }
    );
  } finally {
    unregister?.();
    editor.dispose();
  }
});

test('command dispatch refreshes observed dirty collections after listener writes', () => {
  const editor = createEditor();
  const command = {};
  let text: TextNode | undefined;
  let listener: number | undefined;
  try {
    editor.update(
      () => {
        text = $createTextNode('before');
        $getRoot().append($createParagraphNode().append(text));
      },
      { discrete: true }
    );
    listener = editor.runtime.backend.registerListener(command, 0, () => {
      if (!text) throw new Error('Missing native text');
      text.setTextContent('after');
      return true;
    });
    editor.update(
      () => {
        if (!text) throw new Error('Missing native text');
        const leaves = editor._dirtyLeaves;
        expect(leaves.has(text.getKey())).toBe(false);
        expect(editor.runtime.backend.dispatchCommand(command, null)).toBe(
          true
        );
        expect(leaves.has(text.getKey())).toBe(true);
      },
      { discrete: true }
    );
    editor.read(() => expect($getRoot().getTextContent()).toBe('after'));
  } finally {
    if (listener !== undefined) editor.runtime.backend.unregister(listener);
    editor.dispose();
  }
});
