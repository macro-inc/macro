import type { ElementTransformer } from '@lexical/markdown';
import type { ElementNode, LexicalNode } from 'lexical';
import {
  $createMagicChipNode,
  isMagicChipMessage,
  $isMagicChipNode,
  isMagicChipStatus,
  type MagicChipData,
  MagicChipNode,
} from '../nodes/MagicChipNode';
import { replaceElementWithUnknownMention, UnknownMentionNode } from './unknownFallback';

function isMagicChipData(value: unknown): value is MagicChipData {
  if (!value || typeof value !== 'object') return false;
  const data = value as Record<string, unknown>;
  return (
    typeof data.agentSessionId === 'string' &&
    typeof data.channelId === 'string' &&
    isMagicChipMessage(data.promptedMessage) &&
    isMagicChipStatus(data.status)
  );
}

/** Internal markdown transformer for a static Magic Chip. */
export const I_MAGIC_CHIP: ElementTransformer = {
  dependencies: [MagicChipNode, UnknownMentionNode],
  type: 'element',
  regExp: /<m-magic-chip>(.*?)<\/m-magic-chip>/,
  export: (node: LexicalNode) => {
    if (!$isMagicChipNode(node)) return null;
    return `<m-magic-chip>${JSON.stringify(node.exportComponentProps())}</m-magic-chip>`;
  },
  replace: (parent: ElementNode, _, match: string[]) => {
    try {
      const data: unknown = JSON.parse(match[1] ?? '');
      if (!isMagicChipData(data)) throw new Error('invalid magic chip data');
      parent.replace($createMagicChipNode(data));
    } catch (error) {
      console.error('Error in I_MAGIC_CHIP replace:', error);
      replaceElementWithUnknownMention(parent, 'Unknown Magic Chip');
    }
  },
};
