// Abstract positions resolve only against the actual upstream editor state.

import { $isListItemNode, type ListType } from '@lexical/list';
import { $convertFromMarkdownString } from '@lexical/markdown';
import { ALL_TRANSFORMERS } from '@macro-inc/lexical-core/transformers';
import {
  $createParagraphNode,
  $createRangeSelection,
  $getRoot,
  $isElementNode,
  $setSelection,
  type ElementNode,
  type LexicalNode,
  type TextFormatType,
} from 'lexical';
import largeSnippet from '../../crates/sync_sim/fixtures/large-paste.md' with {
  type: 'text',
};
import shortSnippets from '../../crates/sync_sim/fixtures/markdown-snippets.json';
import {
  $blockNode,
  $setBlockType,
  $setListType,
  $table,
  $toggleList,
  type LexicalSession,
} from '../../services/ai-editing-worker/src/ai-editing/ai-toolkit';
import type { EditorOp, Pos } from './generated';

function blocks(): ElementNode[] {
  const result: ElementNode[] = [];
  function visit(node: LexicalNode): boolean {
    if (!$isElementNode(node)) return false;
    let childBlock = false;
    for (const child of node.getChildren())
      childBlock = visit(child) || childBlock;
    const block = !node.isInline();
    if (block && !childBlock) result.push(node);
    return block || childBlock;
  }
  for (const child of $getRoot().getChildren()) visit(child);
  return result;
}
function point(at: Pos) {
  const all = blocks();
  if (!all.length) throw new Error('editor operation has no live block');
  const block = all[at.block % all.length];
  const texts = block.getAllTextNodes();
  if (!texts.length)
    return { block, node: block, offset: 0, type: 'element' as const };
  let offset =
    at.offset %
    (texts.reduce((length, node) => length + node.getTextContentSize(), 0) + 1);
  for (const node of texts) {
    const text = node.getTextContent();
    if (offset <= text.length) {
      if (
        offset > 0 &&
        offset < text.length &&
        text.charCodeAt(offset - 1) >= 0xd800 &&
        text.charCodeAt(offset - 1) <= 0xdbff &&
        text.charCodeAt(offset) >= 0xdc00 &&
        text.charCodeAt(offset) <= 0xdfff
      )
        offset--;
      return { block, node, offset, type: 'text' as const };
    }
    offset -= text.length;
  }
  throw new Error('live editor position failed to resolve');
}
function range(from: Pos, to: Pos) {
  const anchor = point(from);
  const focus = point(to);
  const selection = $createRangeSelection();
  selection.anchor.set(anchor.node.getKey(), anchor.offset, anchor.type);
  selection.focus.set(focus.node.getKey(), focus.offset, focus.type);
  $setSelection(selection);
  return { selection, block: anchor.block };
}

export function edit(session: LexicalSession, op: EditorOp): void {
  if (typeof op === 'string') {
    switch (op) {
      case 'Undo':
      case 'Redo':
        throw new Error(
          'the shipping AI workspace has no collaborative undo binding'
        );
      default: {
        const unexpected: never = op;
        throw new Error(`unsupported editor action ${unexpected}`);
      }
    }
  }
  if (op.Type !== undefined) {
    range(op.Type.at, op.Type.at).selection.insertText(op.Type.text);
  } else if (op.Format !== undefined) {
    const formats: TextFormatType[] = [
      'bold',
      'italic',
      'code',
      'strikethrough',
    ];
    range(op.Format.from, op.Format.to).selection.formatText(
      formats[op.Format.format % 4]
    );
  } else if (op.DeleteRange !== undefined) {
    range(op.DeleteRange.from, op.DeleteRange.to).selection.removeText();
  } else if (op.SplitBlock !== undefined) {
    range(op.SplitBlock.at, op.SplitBlock.at).selection.insertParagraph();
  } else if (op.SetBlock !== undefined) {
    const { block } = range(op.SetBlock.at, op.SetBlock.at);
    const kind = op.SetBlock.kind % 6;
    $setBlockType(session, block, () => {
      if (kind === 0) return $blockNode({ type: 'paragraph' });
      if (kind < 4) return $blockNode({ type: 'heading', level: kind });
      if (kind === 4) return $blockNode({ type: 'quote' });
      return $blockNode({ type: 'code' });
    });
  } else if (op.ToggleList !== undefined) {
    const { block } = range(op.ToggleList.at, op.ToggleList.at);
    const kinds: ListType[] = ['number', 'bullet', 'check'];
    const kind = kinds[op.ToggleList.kind % 3];
    if ($isListItemNode(block)) $setListType(block, kind, session);
    else $toggleList([block], kind);
  } else if (op.InsertTable !== undefined) {
    const { block } = range(op.InsertTable.at, op.InsertTable.at);
    const rows = Array.from({ length: (op.InsertTable.rows % 4) + 1 }, () =>
      Array.from({ length: (op.InsertTable.cols % 4) + 1 }, () => '')
    );
    block.insertAfter($table(rows));
  } else if (op.PasteMarkdown !== undefined) {
    const { selection } = range(op.PasteMarkdown.at, op.PasteMarkdown.at);
    const saved = selection.clone();
    const scratch = $createParagraphNode();
    const index = op.PasteMarkdown.snippet % (shortSnippets.length + 1);
    $convertFromMarkdownString(
      shortSnippets[index] ?? largeSnippet,
      ALL_TRANSFORMERS,
      scratch
    );
    const nodes = scratch.getChildren();
    $setSelection(saved);
    saved.insertNodes(nodes);
  } else if (
    op.MarkdownShortcut !== undefined ||
    op.Backspace !== undefined ||
    op.Indent !== undefined ||
    op.Outdent !== undefined ||
    op.Select !== undefined
  ) {
    throw new Error(
      'action requires a browser editor binding, absent in the shipping AI workspace'
    );
  } else {
    const unexpected: never = op;
    throw new Error(`unsupported editor action ${JSON.stringify(unexpected)}`);
  }
}
