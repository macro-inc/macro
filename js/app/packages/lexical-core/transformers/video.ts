import type { ElementTransformer } from '@lexical/markdown';
import type { ElementNode, LexicalNode } from 'lexical';
import { $createVideoNode, $isVideoNode, VideoNode } from '../nodes/VideoNode';

// Internal transformer — always uses <m-video> for unambiguous round-tripping.
export const I_VIDEO: ElementTransformer = {
  dependencies: [VideoNode],
  type: 'element',
  regExp: /<m-video>(.*?)<\/m-video>/,
  export: (node: LexicalNode) => {
    if (!$isVideoNode(node)) return null;
    if (node.getSrcType() === 'local') return null;
    if (!node.getUrl()) return null;

    const data = JSON.stringify({
      url: node.getUrl(),
      srcType: node.getSrcType(),
      id: node.getId(),
      width: node.getWidth(),
      height: node.getHeight(),
      scale: node.getScale(),
      controls: node.getControls(),
      constrainedWidth: node.getConstrainedWidth(),
      constrainedHeight: node.getConstrainedHeight(),
    });

    return `<m-video>${data}</m-video>`;
  },
  replace: (parent: ElementNode, _, match: RegExpMatchArray) => {
    try {
      const data = JSON.parse(match[1]);
      if (!data.url) throw new Error('Missing url field');

      const videoNode = $createVideoNode({
        srcType: data.srcType || 'url',
        url: data.url,
        id: data.id || '',
        width: data.width || 0,
        height: data.height || 0,
        scale: data.scale || 1,
        controls: data.controls ?? true,
        constrainedWidth: data.constrainedWidth ?? undefined,
        constrainedHeight: data.constrainedHeight ?? undefined,
      });
      parent.append(videoNode);
    } catch (e) {
      console.error('Failed to parse m-video:', e);
    }
  },
};
