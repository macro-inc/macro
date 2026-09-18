import {
  $isTableCellNode,
  $isTableNode,
  $isTableRowNode,
  type TableCellNode,
} from '@lexical/table';
import {
  $createParagraphNode,
  $isElementNode,
  type ElementNode,
  type LexicalNode,
} from 'lexical';

/**
 * Block types the client table plugin will keep as direct children of a
 * `tablecell`. Everything else is either salvaged (inlines/text wrapped in a
 * paragraph) or stripped (nested table structure). The worker must not commit
 * a tree the client would refuse.
 */
export const TABLE_CELL_ALLOWED_CHILD_TYPES: ReadonlySet<string> = new Set([
  'paragraph',
  'heading',
  'list',
  'quote',
  'code',
  'custom-code',
  'image',
  'video',
]);

export type EditorTreeIssue = {
  path: string;
  message: string;
};

export type TableCellSalvage = {
  salvagedTypes: string[];
  removedTypes: string[];
};

/** True for a text-bearing block the AI editing ops may mutate. */
export function $isContentBlock(node: LexicalNode): node is ElementNode {
  if (!$isElementNode(node) || node.isInline()) return false;
  const type = node.getType();
  return (
    type !== 'root' &&
    type !== 'table' &&
    type !== 'tablerow' &&
    type !== 'tablecell'
  );
}

const CELL_TEXT_BLOCK_TYPES: ReadonlySet<string> = new Set([
  'paragraph',
  'heading',
  'quote',
  'code',
  'custom-code',
]);

/**
 * The node `$setText` / `$appendText` may target when the caller handed a
 * `<td>` id. A `list` is a legal cell child but not a legal `$setText`
 * target (that would leave `list → text`). Lock onto a paragraph/heading/
 * quote/code, or the first list item of a list-only cell.
 */
export function $cellTextTarget(cell: TableCellNode): ElementNode | null {
  for (const child of cell.getChildren()) {
    if (!$isElementNode(child)) continue;
    if (CELL_TEXT_BLOCK_TYPES.has(child.getType())) return child;
    if (child.getType() === 'list') {
      const item = child
        .getChildren()
        .find((node) => node.getType() === 'listitem');
      if (item && $isElementNode(item)) return item;
    }
  }
  return null;
}

/** Walk the tree and report parent/child shapes the client will not accept. */
export function validateEditorTree(root: ElementNode): EditorTreeIssue[] {
  const issues: EditorTreeIssue[] = [];
  walk(root, 'root', issues);
  return issues;
}

export function $assertValidEditorTree(root: ElementNode): void {
  const issues = validateEditorTree(root);
  if (issues.length === 0) return;
  const preview = issues
    .slice(0, 5)
    .map((issue) => `${issue.path}: ${issue.message}`)
    .join('; ');
  throw new Error(
    `invalid editor tree (${issues.length} issue${issues.length === 1 ? '' : 's'}): ${preview}`
  );
}

/**
 * Repair one cell in place. Bare text / inlines become a paragraph so the
 * content survives; nested table structure is still dropped (it cannot render
 * inside a cell). Returns what changed so the caller can log.
 */
export function $salvageTableCellChildren(
  cell: TableCellNode
): TableCellSalvage {
  const salvagedTypes: string[] = [];
  const removedTypes: string[] = [];
  for (const child of cell.getChildren()) {
    if (TABLE_CELL_ALLOWED_CHILD_TYPES.has(child.getType())) continue;
    const type = child.getType();
    if (
      $isTableNode(child) ||
      $isTableRowNode(child) ||
      $isTableCellNode(child)
    ) {
      removedTypes.push(type);
      child.remove();
      continue;
    }
    if (child.isInline()) {
      salvagedTypes.push(type);
      const paragraph = $createParagraphNode();
      child.replace(paragraph);
      paragraph.append(child);
      continue;
    }
    removedTypes.push(type);
    child.remove();
  }
  return { salvagedTypes, removedTypes };
}

function walk(
  node: LexicalNode,
  path: string,
  issues: EditorTreeIssue[]
): void {
  if (!$isElementNode(node)) return;
  const type = node.getType();
  const children = node.getChildren();

  if (type === 'table') {
    assertChildren(children, path, issues, (child) =>
      child.getType() === 'tablerow'
        ? undefined
        : `table child must be tablerow, got ${child.getType()}`
    );
  } else if (type === 'tablerow') {
    assertChildren(children, path, issues, (child) =>
      child.getType() === 'tablecell'
        ? undefined
        : `tablerow child must be tablecell, got ${child.getType()}`
    );
  } else if (type === 'tablecell') {
    assertChildren(children, path, issues, (child) =>
      TABLE_CELL_ALLOWED_CHILD_TYPES.has(child.getType())
        ? undefined
        : `tablecell child must be a content block, got ${child.getType()}`
    );
  } else if (type === 'list') {
    assertChildren(children, path, issues, (child) =>
      child.getType() === 'listitem'
        ? undefined
        : `list child must be listitem, got ${child.getType()}`
    );
  } else {
    assertChildren(children, path, issues, (child) => {
      const childType = child.getType();
      if (childType === 'tablerow' || childType === 'tablecell') {
        return `${childType} must be nested under its table parent, not ${type}`;
      }
      return undefined;
    });
  }

  for (const [index, child] of children.entries()) {
    walk(child, `${path}/${index}:${child.getType()}`, issues);
  }
}

function assertChildren(
  children: LexicalNode[],
  path: string,
  issues: EditorTreeIssue[],
  check: (child: LexicalNode) => string | undefined
): void {
  for (const [index, child] of children.entries()) {
    const message = check(child);
    if (message) {
      issues.push({
        path: `${path}/${index}:${child.getType()}`,
        message,
      });
    }
  }
}
