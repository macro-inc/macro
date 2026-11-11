/** @vitest-environment jsdom */
import { $createListItemNode, $createListNode } from '@lexical/list';
import {
  $createImageNode,
  ImageNode,
  SupportedNodeTypes,
} from '@macro-inc/lexical-core';
import {
  $createNodeSelection,
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  $setSelection,
  type BaseSelection,
  createEditor,
} from 'lexical';
import { expect, test } from 'vitest';
import { createLexicalGifMenuHost } from '../../editing/overlay-hosts/lexical-gif';
import { createPluginManager } from '../pluginManager';
import { $insertGifNode } from './gifPlugin';

test('actual Source GIF host completes ownership callback for a NodeSelection without attaching the new image', () => {
  const editor = createEditor({
    nodes: [ImageNode],
    onError(error) {
      throw error;
    },
  });
  const plugins = createPluginManager(editor, 'markdown-sync');
  const element = document.createElement('div');
  document.body.appendChild(element);
  editor.setRootElement(element);
  const host = createLexicalGifMenuHost(
    () => editor,
    () => plugins
  );
  let target: BaseSelection | null = null;
  try {
    editor.update(
      () => {
        const image = $createImageNode({
          srcType: 'url',
          url: 'https://example.test/original.gif',
        });
        $getRoot().append($createParagraphNode().append(image));
        const selection = $createNodeSelection();
        selection.add(image.getKey());
        $setSelection(selection);
        target = host.captureTarget();
      },
      { discrete: true }
    );
    const before = editor.getEditorState().toJSON();
    const insertion = host.prepareInsertion(target, () => true);
    if (!insertion) throw new Error('Missing actual Source insertion');
    let owned = false;
    const result = host.commit(
      insertion,
      {
        id: 'fixture-gif',
        title: 'Gif title',
        previewUrl: 'https://example.test/preview.gif',
        url: 'https://example.test/source.gif',
        width: 800,
        height: 400,
      },
      'unused-static-file',
      () => {
        owned = true;
      }
    );
    expect(result).toBe(true);
    expect(owned).toBe(true);
    expect(editor.getEditorState().toJSON()).toEqual(before);
    expect(JSON.stringify(editor.getEditorState().toJSON())).not.toContain(
      'unused-static-file'
    );
  } finally {
    plugins.cleanup();
    editor.setRootElement(null);
    element.remove();
  }
});

test('actual Source GIF list split pins its final caret and literal export', () => {
  const editor = createEditor({
    nodes: [...SupportedNodeTypes],
    onError(error) {
      throw error;
    },
  });
  const gif = {
    id: 'fixture-gif',
    title: 'Gif title',
    previewUrl: 'https://example.test/preview.gif',
    url: 'https://example.test/source.gif',
    width: 800,
    height: 400,
  };
  editor.update(
    () => {
      const firstText = $createTextNode('beforeafter');
      const list = $createListNode('bullet').append(
        $createListItemNode().append(firstText),
        $createListItemNode().append($createTextNode('tail'))
      );
      $getRoot().append(list);
      firstText.select(6, 6);
      $insertGifNode(gif, 'source-gif-file');
    },
    { discrete: true }
  );
  editor.getEditorState().read(() => {
    const selection = $getSelection();
    if (!$isRangeSelection(selection))
      throw new Error('Missing actual GIF range');
    const caret = {
      type: selection.anchor.type,
      node: selection.anchor.getNode().getType(),
      text: selection.anchor.getNode().getTextContent(),
      offset: selection.anchor.offset,
    };

    expect(caret).toEqual({
      type: 'element',
      node: 'listitem',
      text: 'tail',
      offset: 0,
    });
  });
});

test('actual Source GIF insertion before its only empty paragraph keeps the old caret', () => {
  const editor = createEditor({
    nodes: [ImageNode],
    onError(error) {
      throw error;
    },
  });
  editor.update(
    () => {
      const paragraph = $createParagraphNode();
      $getRoot().append(paragraph);
      paragraph.selectStart();
      $insertGifNode(
        {
          id: 'fixture-gif',
          title: 'Gif title',
          previewUrl: 'https://example.test/preview.gif',
          url: 'https://example.test/source.gif',
          width: 800,
          height: 400,
        },
        'source-gif-file'
      );
      expect(
        $getRoot()
          .getChildren()
          .map((node) => node.getType())
      ).toEqual(['image', 'paragraph']);
      const selection = $getSelection();
      if (!$isRangeSelection(selection))
        throw new Error('Missing actual empty-paragraph selection');
      expect(selection.anchor.key).toBe(paragraph.getKey());
      expect(selection.anchor.type).toBe('element');
      expect(selection.anchor.offset).toBe(0);
    },
    { discrete: true }
  );
});

test('actual Source GIF paragraph insertion records its resulting selection format and caret', () => {
  const editor = createEditor({
    nodes: [ImageNode],
    onError(error) {
      throw error;
    },
  });
  editor.update(
    () => {
      const text = $createTextNode('beforeafter');
      $getRoot().append($createParagraphNode().append(text));
      const selected = text.select(6, 6);
      selected.format = 1;
      selected.style = 'color: red;';
      $insertGifNode(
        {
          id: 'fixture-gif',
          title: 'Gif title',
          previewUrl: 'https://example.test/preview.gif',
          url: 'https://example.test/source.gif',
          width: 800,
          height: 400,
        },
        'source-gif-file'
      );
      const selection = $getSelection();
      if (!$isRangeSelection(selection))
        throw new Error('Missing Source paragraph range');
      expect(selection.isCollapsed()).toBe(true);
      const observed = {
        node: selection.anchor.getNode().getType(),
        text: selection.anchor.getNode().getTextContent(),
        type: selection.anchor.type,
        offset: selection.anchor.offset,
        format: selection.format,
        style: selection.style,
      };
      expect(observed).toEqual({
        node: 'paragraph',
        text: 'after',
        type: 'element',
        offset: 0,
        format: 1,
        style: 'color: red;',
      });
    },
    { discrete: true }
  );
});
