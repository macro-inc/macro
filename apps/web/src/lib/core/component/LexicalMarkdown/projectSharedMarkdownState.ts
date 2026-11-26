import type { SerializedLexicalNode } from 'lexical';

export function markdownChildren(
  node?: SerializedLexicalNode
): SerializedLexicalNode[] | undefined {
  if (node && 'children' in node && Array.isArray(node.children)) {
    return node.children;
  }
}

/** Project each editor node against the physical Loro container it will update. */
export function projectSharedMarkdownState(
  current: SerializedLexicalNode,
  stored: SerializedLexicalNode | undefined,
  project: (
    current: SerializedLexicalNode,
    stored: SerializedLexicalNode | undefined
  ) => void
): void {
  project(current, stored);

  const currentChildren = markdownChildren(current);
  if (!currentChildren?.length) return;

  // Mirror matches within each movable list and targets the last stored
  // occurrence of a duplicate ID. Match its target instead of copying a
  // value from another list or an earlier physical container.
  const storedChildren = markdownChildren(stored);
  const storedSiblings = new Map<string, SerializedLexicalNode>();
  for (const child of storedChildren ?? []) {
    const id = child.$?.id;
    if (typeof id === 'string' && id) storedSiblings.set(id, child);
  }
  for (const child of currentChildren) {
    const id = child.$?.id;
    projectSharedMarkdownState(
      child,
      typeof id === 'string' ? storedSiblings.get(id) : undefined,
      project
    );
  }
}
