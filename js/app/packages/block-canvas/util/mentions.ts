import { type CanvasNode, isFileNode } from '@block-canvas/model/CanvasModel';
import { useTextNodeEditors } from '@block-canvas/store/textNodeEditors';
import { untrackMention } from '@core/signal/mention';
import {
  $isDocumentMentionNode,
  type DocumentMentionNode,
} from '@lexical-core/nodes/DocumentMentionNode';
import { $getRoot, $isElementNode, type LexicalEditor } from 'lexical';

export interface MentionInfo {
  mentionUuid: string;
  documentId: string;
}

/**
 * Extracts all document mentions from a Lexical editor
 */
function extractMentionsFromEditor(editor: LexicalEditor): MentionInfo[] {
  const mentions: MentionInfo[] = [];

  editor.getEditorState().read(() => {
    const root = $getRoot();
    const collectMentions = (node: any) => {
      if ($isDocumentMentionNode(node)) {
        const mentionNode = node as DocumentMentionNode;
        const mentionUuid = mentionNode.getMentionUuid();
        const documentId = mentionNode.getDocumentId();
        if (mentionUuid && documentId) {
          mentions.push({ mentionUuid, documentId });
        }
      }
      if ($isElementNode(node)) {
        node.getChildren().forEach(collectMentions);
      }
    };

    root.getChildren().forEach(collectMentions);
  });

  return mentions;
}

export async function untrackMentionsInTextNode(
  node: CanvasNode,
  blockId: string,
  nodeId: string
) {
  const getTextNodeEditor = useTextNodeEditors().getEditor;
  if (isFileNode(node) && !node.isChat && !node.isRss) {
    if (node.mentionUuid) {
      await untrackMention(blockId, node.mentionUuid);
    }
  }

  // For text nodes, we need to extract and untrack all mentions
  if (node.type === 'text') {
    const editor = getTextNodeEditor(nodeId);
    if (editor) {
      const mentions = extractMentionsFromEditor(editor);
      await Promise.all(
        mentions.map(({ mentionUuid }) => untrackMention(blockId, mentionUuid))
      );
    }
  }
}
