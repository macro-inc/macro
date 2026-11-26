import { createHeadlessEditor } from '@lexical/headless';
import { $convertFromMarkdownString } from '@lexical/markdown';
import type { SerializedEditorState } from 'lexical';
import { MARKDOWN_GOLDEN } from './markdown-golden.1';
import { serializedEditorStateToLoroSnapshot } from './markdown-loro-snapshot';
import { NodeReplacements, SupportedNodeTypes } from './node-list';
import { type NotionLinks, visitNotionLinks } from './notion/links';
import { notionLines, notionTransformers } from './notion/transformers';
import { $updateAllNodeIds } from './plugins/nodeIdPlugin';
import { serializedEditorStateToMarkdown } from './utils/markdown-state';

export type {
  NotionDatabaseFallbackReason,
  NotionDatabaseOccurrence,
  NotionLinks,
  NotionPageLink,
  NotionUserLink,
} from './notion/links';

/**
 * Converts Notion enhanced markdown to a serialized Lexical editor state with
 * durable node ids. Page, people and database placements resolve through `links`.
 */
export function notionMarkdownToSerializedEditorState(
  markdown: string,
  links: NotionLinks
): SerializedEditorState {
  const editor = createHeadlessEditor({
    nodes: [...SupportedNodeTypes, ...NodeReplacements],
    onError: (error) => {
      throw error;
    },
  });
  editor.update(
    () => {
      $convertFromMarkdownString(
        notionLines(markdown),
        notionTransformers(links),
        undefined,
        true
      );
    },
    { discrete: true }
  );
  editor.update(
    () => {
      $updateAllNodeIds({
        idToNodeKeyMap: new Map(),
        nodeKeyToIdMap: new Map(),
      });
    },
    { discrete: true }
  );
  const state = editor.getEditorState().toJSON();
  const databaseIds = new Set(links.databases?.map((item) => item.containerId));
  visitNotionLinks(state.root, (link, target) => {
    const page = links.pages[target.id];
    if (page && !target.viewId && !databaseIds.has(target.id)) {
      link.url = `/app/md/${page.documentId}`;
    }
  });
  return state;
}

/** A new document's snapshot, and the same content as Macro markdown. */
export type NotionSnapshot = {
  snapshot: Uint8Array;
  markdown: string;
};

/**
 * Converts Notion enhanced markdown to a Loro snapshot for a new document,
 * along with that document's Macro markdown (for mention tracking).
 */
export async function notionMarkdownToLoroSnapshot(
  markdown: string,
  links: NotionLinks
): Promise<NotionSnapshot> {
  if (markdown.trim() === '') {
    return { snapshot: MARKDOWN_GOLDEN, markdown: '' };
  }
  const state = notionMarkdownToSerializedEditorState(markdown, links);
  const snapshot = await serializedEditorStateToLoroSnapshot(state);
  if (!snapshot) {
    throw new Error('Failed to export the Notion page as a Loro snapshot');
  }
  return { snapshot, markdown: serializedEditorStateToMarkdown(state) };
}
