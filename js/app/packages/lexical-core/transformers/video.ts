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
      if (typeof data.url !== 'string' || !data.url) {
        throw new Error('Missing or invalid url field');
      }

      const constrainedWidth =
        data.constrainedWidth != null
          ? Number(data.constrainedWidth) || undefined
          : undefined;
      const constrainedHeight =
        data.constrainedHeight != null
          ? Number(data.constrainedHeight) || undefined
          : undefined;

      const videoNode = $createVideoNode({
        srcType: String(data.srcType || 'url'),
        url: data.url,
        id: String(data.id || ''),
        width: Number(data.width) || 0,
        height: Number(data.height) || 0,
        scale: Number(data.scale) || 1,
        controls: typeof data.controls === 'boolean' ? data.controls : true,
        constrainedWidth,
        constrainedHeight,
      });
      parent.append(videoNode);
    } catch (e) {
      console.error('Failed to parse m-video:', e);
    }
  },
};
