import type { ElementTransformer } from '@lexical/markdown';
import type { ElementNode } from 'lexical';
import { $createImageNode, ImageNode } from '../nodes/ImageNode';
import { $createVideoNode, VideoNode } from '../nodes/VideoNode';
import {
  replaceElementWithUnknownMention,
  UnknownMentionNode,
} from './unknownFallback';

/** Channel attachments render no larger than this box; replies match it. */
const ATTACHMENT_BOUND = 400;

/**
 * An agent's request to attach a static file to its reply. The harness
 * turns each one into a message attachment when it posts the reply, so
 * markers only reach the editor in the agent's own transcript, where the
 * file shows inline. Parse-only: nothing serializes back to a marker.
 */
export const I_ATTACHMENT: ElementTransformer = {
  dependencies: [ImageNode, VideoNode, UnknownMentionNode],
  type: 'element',
  regExp: /^<m-attachment>(.*?)<\/m-attachment>\s*$/,
  export: () => null,
  replace: (parent: ElementNode, _, match: string[]) => {
    try {
      const data = JSON.parse(match[1] ?? '');
      if (typeof data.staticFileId !== 'string' || !data.staticFileId) {
        throw new Error('Missing staticFileId');
      }
      const media = {
        srcType: 'sfs',
        url: '',
        id: data.staticFileId,
        width: Number(data.width) || 0,
        height: Number(data.height) || 0,
        scale: 1,
        constrainedWidth: ATTACHMENT_BOUND,
        constrainedHeight: ATTACHMENT_BOUND,
      };
      if (data.kind === 'image') {
        parent.replace($createImageNode({ ...media, alt: '' }));
        return;
      }
      if (data.kind === 'video') {
        parent.replace($createVideoNode({ ...media, controls: true }));
        return;
      }
      throw new Error(`Unknown attachment kind ${data.kind}`);
    } catch (e) {
      console.error('Failed to parse m-attachment:', e);
      replaceElementWithUnknownMention(parent, 'Unknown Attachment');
    }
  },
};
