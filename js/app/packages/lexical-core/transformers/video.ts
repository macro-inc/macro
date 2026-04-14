import type { ElementTransformer } from '@lexical/markdown';
import type { ElementNode, LexicalNode } from 'lexical';
import { $createVideoNode, $isVideoNode, VideoNode } from '../nodes/VideoNode';

// Internal transformer for videos with constrained dimensions
export const I_VIDEO_CONSTRAINED: ElementTransformer = {
  dependencies: [VideoNode],
  type: 'element',
  regExp: /<m-video>(.*?)<\/m-video>/,
  export: (node: LexicalNode) => {
    if (!$isVideoNode(node)) return null;
    if (node.getSrcType() === 'local') return null;
    if (!node.getUrl()) return null;

    const constrainedWidth = node.getConstrainedWidth();
    const constrainedHeight = node.getConstrainedHeight();
    if (constrainedWidth == null && constrainedHeight == null) {
      return null;
    }

    const data = JSON.stringify({
      url: node.getUrl(),
      srcType: node.getSrcType(),
      id: node.getId(),
      width: node.getWidth(),
      height: node.getHeight(),
      scale: node.getScale(),
      controls: node.getControls(),
      constrainedWidth,
      constrainedHeight,
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

// Standard video transformer (for videos without constraints)
export const VIDEO: ElementTransformer = {
  dependencies: [VideoNode],
  type: 'element',
  export: (node: LexicalNode) => {
    if (!$isVideoNode(node)) return null;
    if (node.getSrcType() === 'local') return null;
    if (!node.getUrl()) return null;

    const url = node.getUrl();
    return `![video](${url})`;
  },
  regExp: /!\[video\]\(([^)\s]+)\)$/,
  replace: (node, _, match) => {
    const [, videoUrl] = match;
    const videoNode = $createVideoNode({
      srcType: 'url',
      url: videoUrl,
      width: 0,
      height: 0,
      id: '',
    });
    node.replace(videoNode);
  },
};
