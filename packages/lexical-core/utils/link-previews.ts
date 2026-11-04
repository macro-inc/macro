import { createHeadlessEditor } from '@lexical/headless';
import { $isAutoLinkNode, $isLinkNode } from '@lexical/link';
import { $convertFromMarkdownString } from '@lexical/markdown';
import { $dfs } from '@lexical/utils';
import { NodeReplacements, SupportedNodeTypes } from '../node-list';
import { ALL_TRANSFORMERS } from '../transformers';

/** Cards a message shows at most, for its first previewable links. */
const MAX_LINK_PREVIEWS = 3;

const MACRO_APP_HOSTS = new Set([
  'macro.com',
  'dev.macro.com',
  'staging.macro.com',
]);

/** A Macro item renders as a mention; its public page would only say "Macro". */
function isMacroAppLink(url: URL): boolean {
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  if (!MACRO_APP_HOSTS.has(host)) return false;
  return url.pathname === '/app' || url.pathname.startsWith('/app/');
}

function isPreviewableUrl(link: string): boolean {
  let url: URL;
  try {
    url = new URL(link);
  } catch {
    return false;
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') return false;
  return !isMacroAppLink(url);
}

/**
 * The web links in the current editor state that get a preview card: in
 * order of first appearance, without repeats, and at most
 * {@link MAX_LINK_PREVIEWS}. Links the author removed, email addresses,
 * links into the Macro app, and URLs in code (never parsed as links) get
 * none. Call inside a read or update.
 */
function $getLinkPreviewUrls(): string[] {
  const urls = new Set<string>();

  for (const { node } of $dfs()) {
    if (urls.size === MAX_LINK_PREVIEWS) break;
    if (!$isLinkNode(node)) continue;
    if ($isAutoLinkNode(node) && node.getIsUnlinked()) continue;

    const url = node.getURL();
    if (isPreviewableUrl(url)) urls.add(url);
  }

  return [...urls];
}

/**
 * Parses a macro markdown string headlessly and returns the links that get a
 * preview card. The server stores previews for these links, and a rendered
 * channel message shows them beneath its text.
 */
export function extractLinkPreviewUrlsFromMarkdown(markdown: string): string[] {
  const editor = createHeadlessEditor({
    nodes: [...SupportedNodeTypes, ...NodeReplacements],
  });

  editor.update(
    () => {
      $convertFromMarkdownString(markdown, ALL_TRANSFORMERS);
    },
    { discrete: true }
  );

  return editor.getEditorState().read(() => $getLinkPreviewUrls());
}
