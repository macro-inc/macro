import { createHeadlessEditor } from '@lexical/headless';
import { $convertToMarkdownString } from '@lexical/markdown';
import { $getRoot } from 'lexical';
import { NodeReplacements, SupportedNodeTypes } from '../node-list';
import { $createImageNode } from '../nodes/ImageNode';
import { ALL_TRANSFORMERS } from '../transformers';

export type ImageMarkdownInput = {
  staticFileId: string;
  url: string;
  width: number;
  height: number;
};

/** Compose channel image markup using the same node and serializer as the editor. */
export function composeImageMarkdown(image: ImageMarkdownInput): string {
  const editor = createHeadlessEditor({
    nodes: [...SupportedNodeTypes, ...NodeReplacements],
  });
  editor.update(
    () => {
      $getRoot().append(
        $createImageNode({
          srcType: 'sfs',
          id: image.staticFileId,
          url: image.url,
          alt: 'Generated image',
          width: image.width,
          height: image.height,
          constrainedWidth: 400,
          constrainedHeight: 400,
        })
      );
    },
    { discrete: true }
  );
  return editor
    .getEditorState()
    .read(() => $convertToMarkdownString(ALL_TRANSFORMERS));
}
