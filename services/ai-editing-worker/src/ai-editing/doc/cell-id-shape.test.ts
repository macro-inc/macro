/**
 * A `<td>` id handed to a text-level op corrupts the cell.
 *
 * `locate.$blockById` resolves an id with
 * `$findMatchingParent(node, n => $isElementNode(n) && !n.isInline())`, and
 * `$findMatchingParent` tests the starting node first. A `TableCellNode` is a
 * non-inline `ElementNode`, so a `<td>` id resolves to the cell ITSELF, and
 * every op routed through `Doc.block()` treats the cell as a text-bearing
 * block. `setCell` guards against this shape (`requireTable` rejects a `<td>`
 * id outright); the text ops do not.
 *
 * Two consequences, both observed in prod document
 * 019ff75a-e442-72e0-9f79-265d3d9d6ed6:
 *   - `setText` on a cell id drops the cell's paragraph and leaves the
 *     Lexical-invalid shape `tablecell -> text`.
 *   - `appendText`/`prependText` on a cell id add ANOTHER bare text node
 *     without removing the existing one, duplicating the cell's content.
 *
 * The three broken cases are `it.fails` — they assert the shape we want and
 * record that we do not produce it yet. Fixing `$blockById` turns them green,
 * which makes `it.fails` throw; drop the `.fails` at that point.
 */
import { $isTableCellNode, $isTableRowNode } from '@lexical/table';
import { $getId } from '@macro-inc/lexical-core/plugins/nodeIdPlugin';
import { $getRoot, $isElementNode, type ElementNode } from 'lexical';
import { describe, expect, it } from 'vitest';
import { read, setup } from '../ai-toolkit/_test-helpers';
import type { LexicalSession } from '../ai-toolkit/session';
import { Doc } from './doc';

function makeTable(rows: string[][]) {
  const { session, ids } = setup('intro');
  const doc = new Doc(session);
  doc.apply({
    kind: 'insertNode',
    ref: 't',
    spec: { block: 'table', rows },
    at: { after: ids[0]! },
  });
  return { session, doc };
}

/** The child types of cell [row, col], e.g. `['paragraph']` when healthy. */
function cellChildTypes(
  session: LexicalSession,
  row: number,
  col: number
): string[] {
  return read(session, () => {
    const table = $getRoot()
      .getChildren()
      .find((n) => $isElementNode(n) && n.getType() === 'table') as ElementNode;
    const cell = table
      .getChildren()
      .filter($isTableRowNode)
      [row]!.getChildren()
      .filter($isTableCellNode)[col]!;
    return cell.getChildren().map((child) => child.getType());
  });
}

/** The id the XML serializer stamps onto `<td id="...">`. */
function cellId(session: LexicalSession, row: number, col: number): string {
  return read(session, () => {
    const table = $getRoot()
      .getChildren()
      .find((n) => $isElementNode(n) && n.getType() === 'table') as ElementNode;
    const cell = table
      .getChildren()
      .filter($isTableRowNode)
      [row]!.getChildren()
      .filter($isTableCellNode)[col]!;
    return $getId(cell) as string;
  });
}

describe('a <td> id given to a text-level op', () => {
  it('setCell keeps the cell well-formed (the correct path)', () => {
    const { session, doc } = makeTable([['H'], ['a']]);
    doc.apply({ kind: 'setCell', table: 't', row: 1, col: 0, text: 'X' });
    expect(cellChildTypes(session, 1, 0)).toEqual(['paragraph']);
  });

  it.fails('setText on a cell id destroys the paragraph wrapper', () => {
    const { session, doc } = makeTable([['H'], ['a']]);
    const id = cellId(session, 1, 0);
    doc.apply({ kind: 'setText', node: id, text: 'X' });
    // Regression target: should stay ['paragraph'].
    expect(cellChildTypes(session, 1, 0)).toEqual(['paragraph']);
  });

  it.fails('appendText on a cell id duplicates instead of replacing', () => {
    const { session, doc } = makeTable([['H'], ['a']]);
    const id = cellId(session, 1, 0);
    doc.apply({ kind: 'appendText', node: id, text: 'X' });
    // Regression target: one paragraph, never a sibling text node.
    expect(cellChildTypes(session, 1, 0)).toEqual(['paragraph']);
  });

  it.fails('repeated writes to a cell id accumulate children', () => {
    const { session, doc } = makeTable([['H'], ['a']]);
    const id = cellId(session, 1, 0);
    doc.apply({ kind: 'setText', node: id, text: 'dup' });
    doc.apply({ kind: 'prependText', node: id, text: 'dup' });
    doc.apply({ kind: 'prependText', node: id, text: 'dup' });
    // Within one session these collapse onto one text node ($prependText
    // extends a plain-text first child), so the shape is ['text'] rather than
    // the prod document's three siblings — separate AI passes produced those.
    expect(cellChildTypes(session, 1, 0)).toEqual(['paragraph']);
  });
});
