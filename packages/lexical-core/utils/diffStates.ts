import { diffChars } from 'diff';
import type { SerializedEditorState, SerializedLexicalNode } from 'lexical';
import { match } from 'ts-pattern';
import type { WordRun } from './diffTypes';
import { type Diff, NEWLINE } from './diffTypes';

type SerNode = {
  type: string;
  text?: string;
  $?: { id?: string };
  children?: SerNode[];
  [key: string]: unknown;
};

const idOf = (node: SerNode): string | undefined => node.$?.id;

// Leaf block types: flatten their inline children to text and diff as a unit.
// Everything else (tables, lists, custom containers, unknown future types) is
// treated as a structural container — recurse through to find content blocks.
const LEAF_TYPES = new Set(['paragraph', 'heading', 'code', 'quote']);

/** Flatten a block's text content (concatenation of descendant text nodes).
 *  Genuine linebreak nodes become a sentinel so the diff sees them. */
function flattenText(node: SerNode): string {
  if (node.type === 'text' && typeof node.text === 'string') return node.text;
  if (node.type === 'linebreak') return NEWLINE;
  return (node.children ?? []).map(flattenText).join('');
}

/**
 * Full character-level diff (jsdiff `diffChars`). Pure insertions/deletions —
 * e.g. typing "OOO" into a word — show just the changed characters. Substitutions
 * (brown -> red) are character-minimal, so they can fragment a little (jsdiff has
 * no semantic-cleanup pass).
 */
export function wordDiff(before: string, after: string): WordRun[] {
  return diffChars(before, after).map((part) => ({
    op: match(part)
      .with({ added: true }, () => 'insert' as const)
      .with({ removed: true }, () => 'delete' as const)
      .otherwise(() => 'keep' as const),
    text: part.value,
  }));
}

// Collect all content blocks (paragraphs, headings, …) from the entire tree,
// keyed by their stable $.id. Recurses through containers transparently.
function collectContentBlocks(root: SerNode): Map<string, SerNode> {
  const out = new Map<string, SerNode>();
  const recurse = (node: SerNode) => {
    if (!LEAF_TYPES.has(node.type)) {
      for (const child of node.children ?? []) recurse(child);
    } else {
      const id = idOf(node);
      if (id) out.set(id, node);
    }
  };
  recurse(root);
  return out;
}

/**
 * Compute a diff between two document versions, paired by `$.id`.
 *
 * - Top-level blocks: INSERT / DELETE (structural changes)
 * - All content blocks (including inside tables/lists): MODIFY when text changes
 *
 * `authorOf` maps a block's `$.id` to the user who changed it.
 */
export function diffStates(
  before: SerializedEditorState,
  after: SerializedEditorState,
  authorOf: (id: string) => string | undefined = () => undefined
): Diff[] {
  const beforeRoot = before.root as unknown as SerNode;
  const afterRoot = after.root as unknown as SerNode;

  const beforeKids = beforeRoot.children ?? [];
  const afterKids = afterRoot.children ?? [];

  const beforeById = new Map<string, SerNode>();
  for (const node of beforeKids) {
    const id = idOf(node);
    if (id) beforeById.set(id, node);
  }
  const afterIds = new Set(afterKids.map(idOf));

  const diffs: Diff[] = [];

  // Top-level deletions.
  for (const node of beforeKids) {
    const id = idOf(node);
    if (id && !afterIds.has(id)) {
      diffs.push({ operation: 'DELETE', node_id: id, author: authorOf(id) });
    }
  }

  // Top-level insertions.
  let prevKeptId: string | undefined;
  for (const node of afterKids) {
    const id = idOf(node);
    if (!id) continue;
    if (!beforeById.has(id)) {
      diffs.push({
        operation: 'INSERT_AFTER',
        node_id: prevKeptId ?? '',
        node: node as unknown as SerializedLexicalNode,
        author: authorOf(id),
      });
    } else {
      prevKeptId = id;
    }
  }

  // MODIFY pass: all content blocks in the tree, including inside tables/lists.
  const beforeBlocks = collectContentBlocks(beforeRoot);
  for (const [id, afterNode] of collectContentBlocks(afterRoot)) {
    const beforeNode = beforeBlocks.get(id);
    if (!beforeNode) continue;
    const beforeText = flattenText(beforeNode);
    const afterText = flattenText(afterNode);
    if (beforeText !== afterText) {
      diffs.push({
        operation: 'MODIFY',
        node_id: id,
        runs: wordDiff(beforeText, afterText),
        author: authorOf(id),
      });
    }
  }

  return diffs;
}
