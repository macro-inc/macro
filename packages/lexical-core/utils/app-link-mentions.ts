import { $isLinkNode, type LinkNode } from '@lexical/link';
import { $dfsIterator } from '@lexical/utils';
import { $getRoot } from 'lexical';
import {
  $createDocumentMentionNode,
  type DocumentMentionInfo,
} from '../nodes/DocumentMentionNode';

// `/app/<segment>/<id>` segments that name one entity, mapped to the mention
// block name the app opens them with: the catch-all `:type/:id` route, the
// SDK's `webUrl()` links (`/app/mail/<id>` for an email thread) and the
// address-bar forms of the tasks, channels and mail views. Agent sessions are
// left out: they take a different chip.
const BLOCK_BY_SEGMENT: Record<string, string> = {
  md: 'md',
  task: 'task',
  tasks: 'task',
  snippet: 'snippet',
  skill: 'skill',
  write: 'write',
  pdf: 'pdf',
  code: 'code',
  image: 'image',
  canvas: 'canvas',
  spreadsheet: 'spreadsheet',
  csv: 'csv',
  pptx: 'pptx',
  video: 'video',
  channel: 'channel',
  channels: 'channel',
  email: 'email',
  mail: 'email',
  chat: 'chat',
  call: 'call',
  database: 'database',
  form: 'form',
  initiative: 'initiative',
  project: 'project',
  routine: 'routine',
  routines: 'routine',
};

// Query parameters that never narrow the target; the web paste path drops the
// same ones.
const IGNORED_PARAMS = new Set(['referral_code']);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function appHostname(hostname: string): string {
  return hostname.toLowerCase().replace(/^www\./, '');
}

function parseUrl(url: string): URL | undefined {
  try {
    return new URL(url);
  } catch {
    return;
  }
}

/**
 * The entity a Macro web app link opens, as a document mention, or undefined
 * when the URL is not a link to one Macro entity (`/app/<type>/<uuid>`) on
 * `appOrigin`, the web app of the environment the content is written in. A
 * link to another environment stays a link: its entity doesn't exist here.
 */
export function macroAppLinkMention(
  url: string,
  appOrigin: string
): DocumentMentionInfo | undefined {
  const parsed = parseUrl(url);
  const origin = parseUrl(appOrigin);
  if (!parsed || !origin) return;
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return;
  if (appHostname(parsed.hostname) !== appHostname(origin.hostname)) return;

  const segments = parsed.pathname.split('/').filter(Boolean);
  if (segments.length !== 3 || segments[0] !== 'app') return;
  const [, segment, id] = segments;
  const blockName = BLOCK_BY_SEGMENT[segment.toLowerCase()];
  if (!blockName || !UUID.test(id)) return;

  const blockParams: Record<string, string> = {};
  parsed.searchParams.forEach((value, key) => {
    if (value && !IGNORED_PARAMS.has(key)) blockParams[key] = value;
  });
  return { documentId: id, documentName: '', blockName, blockParams };
}

/**
 * Replace every link to a Macro entity on `appOrigin` with that entity's
 * mention chip, so a reference written as a URL or a Markdown link still
 * renders as a chip and is tracked as a mention. Agents are told to write
 * mention tags but sometimes write the item's URL instead. A Markdown link's
 * text gives way to the chip's live name.
 */
export function $convertMacroAppLinksToMentions(appOrigin: string): void {
  const links: [LinkNode, DocumentMentionInfo][] = [];
  for (const { node } of $dfsIterator($getRoot())) {
    if (!$isLinkNode(node)) continue;
    const mention = macroAppLinkMention(node.getURL(), appOrigin);
    if (mention) links.push([node, mention]);
  }
  for (const [link, mention] of links) {
    link.replace($createDocumentMentionNode(mention));
  }
}
