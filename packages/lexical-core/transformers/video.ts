import type { ElementTransformer } from '@lexical/markdown';
import type { ElementNode, LexicalNode } from 'lexical';
import { $createVideoNode, $isVideoNode, VideoNode } from '../nodes/VideoNode';
import {
  replaceElementWithUnknownMention,
  UnknownMentionNode,
} from './unknownFallback';

const isVideoUrl = (url: string): boolean => {
  const videoExtensions = [
    '.mp4',
    '.webm',
    '.ogg',
    '.mov',
    '.avi',
    '.mkv',
    '.m4v',
  ];
  const lowerUrl = url.toLowerCase();

  if (videoExtensions.some((ext) => lowerUrl.includes(ext))) {
    return true;
  }

  if (lowerUrl.includes('static-file-service.macro.com/file/')) {
    return true;
  }

  return false;
};

// Internal transformer — always uses <m-video> for unambiguous round-tripping.
export const I_VIDEO: ElementTransformer = {
  dependencies: [VideoNode, UnknownMentionNode],
  type: 'element',
  regExp: /^<m-video>(.*?)<\/m-video>\s*$/,
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
  replace: (parent: ElementNode, _, match: string[]) => {
    try {
      const data = JSON.parse(match[1] ?? '');
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
      replaceElementWithUnknownMention(parent, 'Unknown Video');
    }
  },
};

// Standard markdown link transformer for video URLs
export const VIDEO_LINK: ElementTransformer = {
  dependencies: [VideoNode],
  type: 'element',
  export: (_node: LexicalNode) => {
    return null;
  },
  regExp: /\[([^\]]*)\]\(([^)\s]+)(?:\s"([^"]*)"\s*)?\)$/,
  replace: (node, _, match) => {
    const [, _linkText, url] = match;

    if (!isVideoUrl(url)) {
      return;
    }

    const videoNode = $createVideoNode({
      srcType: 'url',
      url,
      width: 0,
      height: 0,
      id: '',
      controls: true,
      scale: 1,
    });
    node.replace(videoNode);
  },
};
