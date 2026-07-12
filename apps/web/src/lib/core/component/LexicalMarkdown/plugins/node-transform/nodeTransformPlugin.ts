/**
 * @file Plugin that registers NODE_TRANSFORM_<NODE> commands.
 */

import { $createCodeNode, CodeNode } from '@lexical/code';
import { $createLinkNode, LinkNode } from '@lexical/link';
import {
  $createListNode,
  INSERT_CHECK_LIST_COMMAND,
  INSERT_ORDERED_LIST_COMMAND,
  INSERT_UNORDERED_LIST_COMMAND,
  ListNode,
} from '@lexical/list';
import {
  $createHeadingNode,
  $createQuoteNode,
  HeadingNode,
  QuoteNode,
} from '@lexical/rich-text';
import { $setBlocksType } from '@lexical/selection';
import type { ElementName } from '@lexical-core';
import { CustomCodeNode } from '@lexical-core';
import type {
  ElementNode,
  Klass,
  LexicalCommand,
  LexicalEditor,
  LexicalNode,
} from 'lexical';
import {
  $createParagraphNode,
  $getSelection,
  $isRangeSelection,
  COMMAND_PRIORITY_EDITOR,
  createCommand,
  ParagraphNode,
} from 'lexical';

createCommand();

export const NodeTransforms: Record<ElementName, () => ElementNode> = {
  paragraph: () => $createParagraphNode(),
  heading1: () => $createHeadingNode('h1'),
  heading2: () => $createHeadingNode('h2'),
  heading3: () => $createHeadingNode('h3'),
  quote: () => $createQuoteNode(),
  code: () => $createCodeNode(),
  'custom-code': () => $createCodeNode(),
  link: () => $createLinkNode(),
  'list-bullet': () => $createListNode('bullet'),
  'list-number': () => $createListNode('number'),
  'list-check': () => $createListNode('check'),
} as const;

export type NodeTransformType = keyof typeof NodeTransforms;

const dependencies: Record<ElementName, Klass<LexicalNode>> = {
  paragraph: ParagraphNode,
  heading1: HeadingNode,
  heading2: HeadingNode,
  heading3: HeadingNode,
  quote: QuoteNode,
  code: CodeNode,
  'custom-code': CustomCodeNode,
  link: LinkNode,
  'list-bullet': ListNode,
  'list-number': ListNode,
  'list-check': ListNode,
} as const;

export const NODE_TRANSFORM: LexicalCommand<NodeTransformType> =
  createCommand();

function registerNodeTransform(editor: LexicalEditor) {
  const validTransforms = new Set<ElementName>();
  for (const [transform, klass] of Object.entries(dependencies)) {
    if (editor.hasNode(klass)) {
      validTransforms.add(transform as ElementName);
    }
  }

  return editor.registerCommand(
    NODE_TRANSFORM,
    (transform: NodeTransformType): boolean => {
      if (!validTransforms.has(transform)) {
        console.error(
          `Tried to format ${transform} on an editor without its dependent nodes`
        );
        return false;
      }
      const selection = $getSelection();
      if (selection === null) return false;

      if (!$isRangeSelection(selection)) {
        return false;
      }

      if (transform.includes('list')) {
        switch (transform) {
          case 'list-bullet':
            editor.dispatchCommand(INSERT_UNORDERED_LIST_COMMAND, undefined);
            break;
          case 'list-number':
            editor.dispatchCommand(INSERT_ORDERED_LIST_COMMAND, undefined);
            break;
          case 'list-check':
            editor.dispatchCommand(INSERT_CHECK_LIST_COMMAND, undefined);
            break;
        }
        return true;
      }

      $setBlocksType(selection, NodeTransforms[transform]);
      return true;
    },
    COMMAND_PRIORITY_EDITOR
  );
}

/**
 * Add node (full line of text) transforms to the Editor.
 */
export function nodeTransformPlugin() {
  return (editor: LexicalEditor) => {
    return registerNodeTransform(editor);
  };
}
