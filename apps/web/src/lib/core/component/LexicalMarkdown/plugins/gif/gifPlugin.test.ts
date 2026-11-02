import { ImageNode, SupportedNodeTypes } from '@macro-inc/lexical-core';
import { $createParagraphNode, $getRoot, createEditor } from 'lexical';
import { expect, it } from 'vitest';
import { $insertGifNode } from './gifPlugin';
import type { Gif } from './klipy';

it('serializes the inserted ImageNode as a durable static-file reference', () => {
  const editor = createEditor({
    nodes: SupportedNodeTypes,
    onError(error) {
      throw error;
    },
  });
  const gif: Gif = {
    id: 'gif-1',
    title: 'Animated GIF',
    previewUrl: 'https://media.example/preview.gif',
    url: 'https://media.example/animation.gif',
    width: 640,
    height: 480,
  };

  editor.update(
    () => {
      const paragraph = $createParagraphNode();
      $getRoot().append(paragraph);
      paragraph.select();
      $insertGifNode(gif, 'static-1');
    },
    { discrete: true }
  );

  const image = editor.read(() =>
    $getRoot()
      .getChildren()
      .find((node) => node instanceof ImageNode)
  );
  expect(image).toBeInstanceOf(ImageNode);
  const serialized = editor.getEditorState().toJSON().root.children;
  expect(serialized).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        type: 'image',
        srcType: 'sfs',
        id: 'static-1',
        url: '',
        alt: gif.title,
        width: 640,
        height: 480,
        constrainedWidth: 400,
        constrainedHeight: 300,
      }),
    ])
  );
});
