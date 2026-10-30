import { $convertFromMarkdownString } from '@lexical/markdown';
import { $nodesOfType, createEditor } from 'lexical';
import { describe, expect, it } from 'vitest';
import { SupportedNodeTypes } from '../node-list';
import { ImageNode } from '../nodes/ImageNode';
import { UnknownMentionNode } from '../nodes/UnknownMentionNode';
import { VideoNode } from '../nodes/VideoNode';
import { ALL_TRANSFORMERS } from '../transformers';

function parse(markdown: string) {
  const editor = createEditor({
    nodes: SupportedNodeTypes,
    onError: (error) => {
      throw error;
    },
  });
  editor.update(() => $convertFromMarkdownString(markdown, ALL_TRANSFORMERS), {
    discrete: true,
  });
  return editor;
}

describe('attachment markers in agent replies', () => {
  it('shows an image marker as the static image it names', () => {
    const editor = parse(
      'Here it is.\n\n<m-attachment>{"staticFileId":"0198f2c4-5b6a-7c8d-9e0f-1a2b3c4d5e6f","kind":"image","width":1184,"height":864}</m-attachment>'
    );

    editor.getEditorState().read(() => {
      const [image] = $nodesOfType(ImageNode);
      expect(image).toBeDefined();
      expect(image.getSrcType()).toBe('sfs');
      expect(image.getId()).toBe('0198f2c4-5b6a-7c8d-9e0f-1a2b3c4d5e6f');
      expect(image.getWidth()).toBe(1184);
      expect(image.getHeight()).toBe(864);
    });
  });

  it('shows a video marker as the static video it names', () => {
    const editor = parse(
      '<m-attachment>{"staticFileId":"0198f2c4-5b6a-7c8d-9e0f-1a2b3c4d5e70","kind":"video","width":1920,"height":1080}</m-attachment>'
    );

    editor.getEditorState().read(() => {
      const [video] = $nodesOfType(VideoNode);
      expect(video).toBeDefined();
      expect(video.getSrcType()).toBe('sfs');
      expect(video.getId()).toBe('0198f2c4-5b6a-7c8d-9e0f-1a2b3c4d5e70');
    });
  });

  it('shows a marker that names no file as unknown', () => {
    const editor = parse('<m-attachment>not json</m-attachment>');

    editor.getEditorState().read(() => {
      expect($nodesOfType(ImageNode)).toEqual([]);
      expect($nodesOfType(UnknownMentionNode)).toHaveLength(1);
    });
  });
});
