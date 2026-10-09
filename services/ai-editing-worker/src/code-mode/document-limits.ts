import { $blockById } from '../ai-editing/ai-toolkit/locate';
import type { LexicalSession } from '../ai-editing/ai-toolkit/session';
import type { DocumentOp } from '../ai-editing/editor';
import { DocumentRequestError } from '../document-storage';

export const MAX_DOCUMENT_BYTES = 240 * 1024;
const MAX_NODES = 2000;
type StateNode = {
  type?: string;
  $?: Record<string, unknown>;
  children?: StateNode[];
  colSpan?: number;
  rowSpan?: number;
};
const bytes = (value: unknown) =>
  new TextEncoder().encode(JSON.stringify(value)).length;
const tooLarge = () =>
  new DocumentRequestError(
    'Edit exceeds the document size limit. Use fewer matches, smaller text or a smaller table.',
    413
  );

/** Reject uninitialized IDs instead of returning ephemeral IDs that cannot be saved. */
export function inspectDocumentState(
  state: { root: StateNode },
  allowEmpty = false
) {
  const nodes = new Map<string, StateNode>();
  const visit = (node: StateNode, depth: number) => {
    if (depth > 64 || nodes.size >= MAX_NODES) throw tooLarge();
    const id = node.$?.id;
    if (typeof id !== 'string' || !id || id.length > 128 || nodes.has(id))
      throw new DocumentRequestError(
        'Document node IDs need initialization. Open this document in Macro, then read it again.',
        400
      );
    nodes.set(id, node);
    for (const [value, maximum] of [
      [node.colSpan, 50],
      [node.rowSpan, 100],
    ])
      if (
        value !== undefined &&
        (!Number.isInteger(value) || value < 1 || value > maximum!)
      )
        throw tooLarge();
    if (node.type === 'table') {
      const area = (node.children ?? []).reduce(
        (sum, row) =>
          sum +
          (row.children ?? []).reduce(
            (n, cell) => n + (cell.colSpan ?? 1) * (cell.rowSpan ?? 1),
            0
          ),
        0
      );
      if (area > MAX_NODES) throw tooLarge();
    }
    for (const child of node.children ?? []) visit(child, depth + 1);
  };
  if (!state.root.children?.length && !allowEmpty)
    throw new DocumentRequestError(
      'The document is not initialized. Open it in Macro, then read it again.',
      400
    );
  for (const child of state.root.children) visit(child, 1);
  const size = bytes(state);
  if (size > MAX_DOCUMENT_BYTES) throw tooLarge();
  return { nodes, size };
}

/** Bound multiplicative operations before Lexical allocates their output. */
export function preflightOperation(
  op: DocumentOp,
  session: LexicalSession,
  state: ReturnType<typeof inspectDocumentState>
) {
  let addedNodes = 4;
  let growth = bytes(op);
  const occurrences = (node: string, needle: string) => {
    let texts: string[];
    try {
      // The editor retains aliases after retyping a block; resolve those too.
      texts = session.editor.getEditorState().read(() =>
        $blockById(session, node)
          .getAllTextNodes()
          .map((text) => text.getTextContent())
      );
    } catch {
      throw new DocumentRequestError(
        'The edit references an unknown block ID.',
        400
      );
    }
    let count = 0;
    // Match the editor's per-run search and containing-block resolution exactly.
    for (const text of texts) {
      for (
        let at = text.indexOf(needle);
        at !== -1;
        at = text.indexOf(needle, at + needle.length)
      ) {
        if (++count > MAX_NODES) throw tooLarge();
      }
    }
    return count;
  };
  if (
    op.kind === 'replaceText' ||
    op.kind === 'formatText' ||
    op.kind === 'markText' ||
    op.kind === 'linkText'
  ) {
    const count =
      op.scope.kind === 'nth'
        ? 1
        : occurrences(op.node, op.kind === 'replaceText' ? op.find : op.match);
    addedNodes = count * (op.kind === 'replaceText' ? 2 : 4);
    if (op.kind === 'replaceText') growth += count * bytes(op.to);
    if (op.kind === 'linkText') growth += count * bytes(op.url);
  } else if (op.kind === 'clearFormat' && op.match) {
    addedNodes =
      (op.scope.kind === 'nth' ? 1 : occurrences(op.node, op.match)) * 2;
  } else if (op.kind === 'mergeBlocks') {
    growth += op.nodes.length * bytes(op.separator);
  } else if (op.kind === 'insertNode' || op.kind === 'insertInline') {
    if ('block' in op.spec && op.spec.block === 'table')
      addedNodes =
        1 + op.spec.rows.reduce((n, row) => n + 1 + row.length * 3, 0);
    else if ('block' in op.spec && op.spec.block === 'list')
      addedNodes = 1 + op.spec.items.length * 2;
  } else if (op.kind === 'addColumn' || op.kind === 'addRow') {
    const rows = state.nodes.get(op.table)?.children ?? [];
    addedNodes =
      op.kind === 'addColumn'
        ? rows.length * 3
        : 1 +
          Math.max(
            0,
            ...rows.map((row) =>
              (row.children ?? []).reduce(
                (n, cell) => n + (cell.colSpan ?? 1),
                0
              )
            )
          ) *
            3;
  } else if (op.kind === 'setListType') {
    addedNodes = op.nodes.length * 2;
  }
  if (
    state.nodes.size + addedNodes > MAX_NODES ||
    state.size + growth + addedNodes * 512 > MAX_DOCUMENT_BYTES
  )
    throw tooLarge();
}
