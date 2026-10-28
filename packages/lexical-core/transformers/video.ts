import type { ElementTransformer } from '@lexical/markdown';
import type { ElementNode, LexicalNode } from 'lexical';
import { $createVideoNode, $isVideoNode, VideoNode } from '../nodes/VideoNode';
import {
  replaceElementWithUnknownMention,
  UnknownMentionNode,
} from './unknownFallback';

const VIDEO_EXTENSIONS = [
  '.mp4',
  '.webm',
  '.ogg',
  '.mov',
  '.avi',
  '.mkv',
  '.m4v',
] as const;

const VIDEO_EXTENSION_PATTERN = VIDEO_EXTENSIONS.map((ext) =>
  ext.slice(1)
).join('|');

function pathnameHasVideoExtension(pathname: string): boolean {
  const lower = pathname.toLowerCase();
  return VIDEO_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

function textHasVideoExtension(text: string): boolean {
  const lower = text.toLowerCase();
  return VIDEO_EXTENSIONS.some((ext) => lower.includes(ext));
}

function isStaticFileServiceHost(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  return (
    lower === 'static-file-service.macro.com' ||
    lower.endsWith('.static-file-service.macro.com')
  );
}

/** True when `url` (and optional link label) identify a video to embed. */
export const isVideoMarkdownLink = (url: string, linkText = ''): boolean => {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }

  if (pathnameHasVideoExtension(parsed.pathname)) {
    return true;
  }

  // Static-file links often omit an extension in the path; the label usually
  // still names the file (e.g. "Screen Recording.mov").
  if (
    isStaticFileServiceHost(parsed.hostname) &&
    parsed.pathname.toLowerCase().startsWith('/file/') &&
    textHasVideoExtension(linkText)
  ) {
    return true;
  }

  return false;
};

// Standalone markdown link whose URL path ends in a video extension, or whose
// label names a video file on Macro static-file-service (`/file/…` has no ext).
// Lexical slices the match before `replace` runs, so this must not match
// ordinary links. `^`/`$` keep trailing inline links from replacing a paragraph.
const VIDEO_LINK_REGEXP = new RegExp(
  '^(?:' +
    // Label has a video extension; URL is Macro static-file-service /file/…
    String.raw`\[([^\]]*\.(?:${VIDEO_EXTENSION_PATTERN})[^\]]*)\]\((https?:\/\/(?:[\w.-]+\.)?static-file-service\.macro\.com\/file\/[^)\s]+)(?:\s"([^"]*)"\s*)?\)` +
    '|' +
    // URL path ends with a video extension (query/hash allowed after it)
    String.raw`\[([^\]]*)\]\(([^)\s?#]*\.(?:${VIDEO_EXTENSION_PATTERN})(?:[?#][^)\s]*)?)(?:\s"([^"]*)"\s*)?\)` +
    ')\\s*$',
  'i'
);

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

/**
 * Standalone markdown link → video node.
 *
 * The regex must only match video-eligible links: Lexical slices the match out
 * of the paragraph before `replace` runs, so a late reject would drop ordinary
 * links. Anchoring to the full line keeps surrounding inline text intact.
 */
export const VIDEO_LINK: ElementTransformer = {
  dependencies: [VideoNode],
  type: 'element',
  export: (_node: LexicalNode) => null,
  regExp: VIDEO_LINK_REGEXP,
  replace: (node, _, match) => {
    const linkText = match[1] ?? match[4] ?? '';
    const url = match[2] ?? match[5] ?? '';

    if (!isVideoMarkdownLink(url, linkText)) {
      return false;
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
