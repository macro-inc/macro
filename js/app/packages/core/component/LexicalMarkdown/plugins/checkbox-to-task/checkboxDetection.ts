import { $isListItemNode, type ListItemNode } from '@lexical/list';
import { $getRoot, type LexicalNode, type RangeSelection } from 'lexical';

/**
 * Check if a ListItemNode is a checkbox (has a checked state).
 * ListItemNodes in checklists have getChecked() returning a boolean,
 * while regular list items return undefined.
 */
export function $isCheckboxNode(node: LexicalNode): node is ListItemNode {
  if (!$isListItemNode(node)) return false;
  return typeof node.getChecked() === 'boolean';
}

/**
 * Find all checkbox ListItemNodes in the given selection.
 * Walks up from selected nodes to find their checkbox parents.
 */
export function $getSelectedCheckboxes(
  selection: RangeSelection
): ListItemNode[] {
  const selectedNodes = selection.getNodes();
  const checkboxes = new Set<ListItemNode>();
  const root = $getRoot();

  for (const node of selectedNodes) {
    let current: LexicalNode | null = node;

    // Walk up the tree to find ListItemNode ancestors
    while (current && current !== root) {
      if ($isCheckboxNode(current)) {
        checkboxes.add(current);
        break;
      }
      current = current.getParent();
    }
  }

  return Array.from(checkboxes);
}
