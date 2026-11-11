import { createHeadlessEditor } from '@lexical/headless';
import { $convertFromMarkdownString } from '@lexical/markdown';
import type { SerializedEditorState } from 'lexical';
import { MARKDOWN_GOLDEN } from './markdown-golden.1';
import { serializedEditorStateToLoroSnapshot } from './markdown-loro-snapshot';
import { NodeReplacements, SupportedNodeTypes } from './node-list';
import type { NotionLinks } from './notion/links';
import { notionLines, notionTransformers } from './notion/transformers';
import { $updateAllNodeIds } from './plugins/nodeIdPlugin';
import { serializedEditorStateToMarkdown } from './utils/markdown-state';

export type {
  NotionLinks,
  NotionPageLink,
  NotionUserLink,
} from './notion/links';

/**
 * Converts Notion enhanced markdown to a serialized Lexical editor state with
 * durable node ids. Page and people references resolve through `links`.
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
  return editor.getEditorState().toJSON();
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
