import { $isLinkNode, type LinkNode } from '@lexical/link';
import { $dfsIterator } from '@lexical/utils';
import { $getRoot } from 'lexical';
import {
  $createDocumentMentionNode,
  type DocumentMentionInfo,
} from '../nodes/DocumentMentionNode';

// Hosts the Macro web app is served from. The services that import markdown
// don't know their environment's web origin, so accept every one of them.
const MACRO_APP_HOSTS = new Set([
  'macro.com',
  'dev.macro.com',
  'staging.macro.com',
  'localhost',
  '127.0.0.1',
]);

// `/app/<segment>/<id>` segments that name one entity, mapped to the mention
// block name the app opens them with (the catch-all `:type/:id` route and the
// SDK's `webUrl()` links).
const BLOCK_BY_SEGMENT: Record<string, string> = {
  md: 'md',
  task: 'task',
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
  email: 'email',
  chat: 'chat',
  call: 'call',
  database: 'database',
  form: 'form',
  initiative: 'initiative',
  project: 'project',
  routine: 'routine',
  routines: 'routine',
};

// Query parameters that narrow a mention to part of its entity.
const PARAMS_BY_BLOCK: Record<string, readonly string[]> = {
  channel: ['channel_message_id', 'channel_thread_id'],
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The entity a Macro web app link opens, as a document mention, or undefined
 * when the URL is not a link to one Macro entity (`/app/<type>/<uuid>`, with a
 * channel message or thread in its query).
 */
export function macroAppLinkMention(
  url: string
): DocumentMentionInfo | undefined {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return;
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return;
  const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
  if (!MACRO_APP_HOSTS.has(host)) return;

  const segments = parsed.pathname.split('/').filter(Boolean);
  if (segments.length !== 3 || segments[0] !== 'app') return;
  const [, segment, id] = segments;
  const blockName = BLOCK_BY_SEGMENT[segment.toLowerCase()];
  if (!blockName || !UUID.test(id)) return;

  const blockParams: Record<string, string> = {};
  for (const key of PARAMS_BY_BLOCK[blockName] ?? []) {
    const value = parsed.searchParams.get(key);
    if (value) blockParams[key] = value;
  }
  return { documentId: id, documentName: '', blockName, blockParams };
}

/**
 * Replace every link to a Macro entity in the editor with that entity's
 * mention chip, so a reference written as a URL or a Markdown link still
 * renders as a chip and is tracked as a mention. Agents are told to write
 * mention tags but sometimes write the item's URL instead.
 */
export function $convertMacroAppLinksToMentions(): void {
  const links: [LinkNode, DocumentMentionInfo][] = [];
  for (const { node } of $dfsIterator($getRoot())) {
    if (!$isLinkNode(node)) continue;
    const mention = macroAppLinkMention(node.getURL());
    if (mention) links.push([node, mention]);
  }
  for (const [link, mention] of links) {
    link.replace($createDocumentMentionNode(mention));
  }
}
