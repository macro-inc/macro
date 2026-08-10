import type { TextMatchTransformer } from '@lexical/markdown';
import type { TextNode } from 'lexical';
import {
  $createMagicChipNode,
  $isMagicChipNode,
  isMagicChipStatus,
  type MagicChipData,
  MagicChipNode,
} from '../nodes/MagicChipNode';
import {
  replaceTextWithUnknownMention,
  UnknownMentionNode,
} from './unknownFallback';

function isMagicChipData(value: unknown): value is MagicChipData {
  if (!value || typeof value !== 'object') return false;
  const data = value as Record<string, unknown>;
  return (
    typeof data.agentSessionId === 'string' &&
    typeof data.channelId === 'string' &&
    typeof data.promptedTurnId === 'string' &&
    isMagicChipStatus(data.status)
  );
}

/** Internal markdown transformer for a static Magic Chip. */
export const I_MAGIC_CHIP: TextMatchTransformer = {
  dependencies: [MagicChipNode, UnknownMentionNode],
  type: 'text-match',
  regExp: /<m-magic-chip>(.*?)<\/m-magic-chip>/,
  importRegExp: /<m-magic-chip>(.*?)<\/m-magic-chip>/,
  export: (node) => {
    if (!$isMagicChipNode(node)) return null;
    return `<m-magic-chip>${JSON.stringify(node.exportComponentProps())}</m-magic-chip>`;
  },
  replace: (node: TextNode, match: RegExpMatchArray) => {
    try {
      const data: unknown = JSON.parse(match[1]);
      if (!isMagicChipData(data)) throw new Error('invalid magic chip data');
      node.replace($createMagicChipNode(data));
    } catch (error) {
      console.error('Error in I_MAGIC_CHIP replace:', error);
      replaceTextWithUnknownMention(node, 'Unknown Magic Chip');
    }
  },
};
