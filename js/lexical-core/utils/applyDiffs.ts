import {
  $createLineBreakNode,
  $createTextNode,
  $getRoot,
  $isElementNode,
  $isTextNode,
  $parseSerializedNode,
  type ElementNode,
  type LexicalEditor,
  type LexicalNode,
} from 'lexical';
import { match, P } from 'ts-pattern';
import { $getNodeById, type NodeIdMappings } from '../plugins/nodeIdPlugin';
import { $createDiffTextNode, type DiffStatus } from '../nodes/DiffTextNode';
import {
  type DeleteDiff,
  type Diff,
  type InsertDiff,
  type ModifyDiff,
  NEWLINE,
  type WordRun,
} from './diffTypes';

// Recursively retag every text leaf of a node as a diff run (whole-block
// insert/delete). An empty block (a blank paragraph from pressing Enter) has no
// text to mark, so it gets a ¶ marker — otherwise an added/removed blank line is
// invisible.
function markAllText(node: LexicalNode, status: DiffStatus, author: string) {
  if ($isTextNode(node)) {
    node.replace($createDiffTextNode(node.getTextContent(), status, author));
    return;
  }
  if ($isElementNode(node)) {
    const children = node.getChildren();
    for (const child of children) markAllText(child, status, author);
    if (children.length === 0 && !node.isInline()) {
      node.append($createDiffTextNode('¶', status, author));
    }
  }
}

function applyInsert(
  editor: LexicalEditor,
  diff: InsertDiff,
  mappings: NodeIdMappings
) {
  const newNode = $parseSerializedNode(diff.node);
  markAllText(newNode, 'insert', diff.author ?? '');
  const anchor = diff.node_id
    ? $getNodeById(editor, mappings.idToNodeKeyMap, diff.node_id)
    : null;
  if (anchor) {
    if (diff.operation === 'INSERT_BEFORE') anchor.insertBefore(newNode);
    else anchor.insertAfter(newNode);
  } else {
    // no anchor (insert at the very start) — prepend to root
    const first = $getRoot().getFirstChild();
    if (first) first.insertBefore(newNode);
    else $getRoot().append(newNode);
  }
}

function applyDelete(
  editor: LexicalEditor,
  diff: DeleteDiff,
  mappings: NodeIdMappings
) {
  const node = $getNodeById(editor, mappings.idToNodeKeyMap, diff.node_id);
  if (node) markAllText(node, 'delete', diff.author ?? '');
}

function applyModify(
  editor: LexicalEditor,
  diff: ModifyDiff,
  mappings: NodeIdMappings
) {
  const node = $getNodeById(editor, mappings.idToNodeKeyMap, diff.node_id);
  if (!node || !$isElementNode(node)) return;
  // Tier 1 rebuilds a block's inline content from text runs. A structured block
  // (table, list, …) has block-level element children — rebuilding it as text
  // would corrupt it, so skip. Per-cell/item diffing is the nested follow-up.
  if (node.getChildren().some((c) => $isElementNode(c) && !c.isInline()))
    return;
  const author = diff.author ?? '';
  node.clear();
  for (const run of diff.runs) appendRun(node, run, author);
}

// Append a run's content, turning the linebreak sentinel back into real breaks.
// A genuine inserted/deleted break shows a ¶ marker in the author's color; kept
// breaks render as plain line breaks (layout only, no marker).
function appendRun(block: ElementNode, run: WordRun, author: string) {
  const segments = run.text.split(NEWLINE);
  segments.forEach((segment, index) => {
    if (segment) {
      block.append(
        run.op === 'keep'
          ? $createTextNode(segment)
          : $createDiffTextNode(segment, run.op, author)
      );
    }
    // a genuine line break sat between this segment and the next
    if (index < segments.length - 1) {
      match(run.op)
        .with('keep', () => {
          block.append($createLineBreakNode());
        })
        .with('insert', () => {
          block.append($createDiffTextNode('¶', 'insert', author));
          block.append($createLineBreakNode());
        })
        .with('delete', () => {
          block.append($createDiffTextNode('¶', 'delete', author));
        })
        .exhaustive();
    }
  });
}

// Render a diff into an editor loaded with the BEFORE state. Everything renders
// inline via DiffTextNode on the document's normal blocks — no wrapper nodes.
export function applyDiffs(
  editor: LexicalEditor,
  diffs: readonly Diff[],
  mappings: NodeIdMappings
): void {
  editor.update(
    () => {
      for (const diff of diffs) {
        match(diff)
          .with({ operation: P.union('INSERT_AFTER', 'INSERT_BEFORE') }, (d) =>
            applyInsert(editor, d, mappings)
          )
          .with({ operation: 'DELETE' }, (d) =>
            applyDelete(editor, d, mappings)
          )
          .with({ operation: 'MODIFY' }, (d) =>
            applyModify(editor, d, mappings)
          )
          .exhaustive();
      }
    },
    { discrete: true }
  );
}
