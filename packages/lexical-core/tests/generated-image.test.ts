import {
  $convertFromMarkdownString,
  $convertToMarkdownString,
} from '@lexical/markdown';
import { $nodesOfType, createEditor } from 'lexical';
import { describe, expect, it } from 'vitest';
import { SupportedNodeTypes } from '../node-list';
import { ImageNode } from '../nodes/ImageNode';
import { INTERNAL_TRANSFORMERS } from '../transformers';
import { composeImageMarkdown } from '../utils/image-markdown';

describe('generated channel images', () => {
  it('retains dimensions through parsing and message editing before image download', () => {
    const editor = createEditor({
      nodes: SupportedNodeTypes,
      onError: (error) => {
        throw error;
      },
    });
    const image = {
      url: 'https://static.example/file/image',
      srcType: 'sfs',
      id: 'image',
      alt: 'Generated image',
      width: 1536,
      height: 1024,
      constrainedWidth: 400,
      constrainedHeight: 400,
    };
    editor.update(
      () => {
        $convertFromMarkdownString(
          composeImageMarkdown({
            staticFileId: image.id,
            url: image.url,
            width: image.width,
            height: image.height,
          }),
          INTERNAL_TRANSFORMERS
        );
      },
      { discrete: true }
    );
    editor.getEditorState().read(() => {
      const [node] = $nodesOfType(ImageNode);
      expect(node).toBeDefined();
      expect(node.getWidth()).toBe(1536);
      expect(node.getHeight()).toBe(1024);
      expect(node.getEffectiveDimensions()).toEqual({
        width: 400,
        height: 267,
      });
      const markdown = $convertToMarkdownString(INTERNAL_TRANSFORMERS);
      const serialized = JSON.parse(
        markdown.trim().slice('<m-image>'.length, -'</m-image>'.length)
      );
      expect(serialized).toMatchObject(image);
    });
  });
});

describe('SDK static image markup', () => {
  it('parses StaticImage.toMarkdown() into a sized static-file image', () => {
    const editor = createEditor({
      nodes: SupportedNodeTypes,
      onError: (error) => {
        throw error;
      },
    });
    editor.update(
      () => {
        $convertFromMarkdownString(
          'Rendered image:\n\n<m-image>{"url":"https://static.example/file/render","alt":"Plan\\u003c/m-image\\u003e","srcType":"sfs","id":"render","width":200,"height":160,"scale":1,"constrainedWidth":400,"constrainedHeight":400}</m-image>',
          INTERNAL_TRANSFORMERS
        );
      },
      { discrete: true }
    );
    editor.getEditorState().read(() => {
      const [node] = $nodesOfType(ImageNode);
      expect(node).toBeDefined();
      expect(node.getSrcType()).toBe('sfs');
      expect(node.getId()).toBe('render');
      expect(node.getUrl()).toBe('https://static.example/file/render');
      expect(node.getAlt()).toBe('Plan</m-image>');
      expect(node.getEffectiveDimensions()).toEqual({
        width: 200,
        height: 160,
      });
    });
  });
});
