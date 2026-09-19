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
 * `$blockById` now treats table structure as non-content: a `<td>` id
 * resolves to the cell's paragraph, and `Doc.tx` refuses to commit a tree
 * the client would reject. These cases are the regression lock for that.
 */
import { $createListItemNode, $createListNode } from '@lexical/list';
import { $isTableCellNode, $isTableRowNode } from '@lexical/table';
import { $getId } from '@macro-inc/lexical-core/plugins/nodeIdPlugin';
import { validateEditorTree } from '@macro-inc/lexical-core/utils/editor-tree';
import {
  $createTextNode,
  $getRoot,
  $isElementNode,
  type ElementNode,
} from 'lexical';
import { describe, expect, it } from 'vitest';
import { edit, read, setup } from '../ai-toolkit/_test-helpers';
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

  it('setText on a cell id keeps the paragraph wrapper', () => {
    const { session, doc } = makeTable([['H'], ['a']]);
    const id = cellId(session, 1, 0);
    doc.apply({ kind: 'setText', node: id, text: 'X' });
    expect(cellChildTypes(session, 1, 0)).toEqual(['paragraph']);
    expect(
      read(session, () => {
        const table = $getRoot()
          .getChildren()
          .find((n) => $isElementNode(n) && n.getType() === 'table');
        return table?.getTextContent();
      })
    ).toContain('X');
  });

  it('appendText on a cell id does not add a sibling text node', () => {
    const { session, doc } = makeTable([['H'], ['a']]);
    const id = cellId(session, 1, 0);
    doc.apply({ kind: 'appendText', node: id, text: 'X' });
    expect(cellChildTypes(session, 1, 0)).toEqual(['paragraph']);
  });

  it('repeated writes to a cell id stay on one paragraph', () => {
    const { session, doc } = makeTable([['H'], ['a']]);
    const id = cellId(session, 1, 0);
    doc.apply({ kind: 'setText', node: id, text: 'dup' });
    doc.apply({ kind: 'prependText', node: id, text: 'dup' });
    doc.apply({ kind: 'prependText', node: id, text: 'dup' });
    expect(cellChildTypes(session, 1, 0)).toEqual(['paragraph']);
  });

  it('setText on a list-only cell id keeps the list, not list → text', () => {
    const { session, doc } = makeTable([['H'], ['a']]);
    edit(session, () => {
      const table = $getRoot()
        .getChildren()
        .find((n) => $isElementNode(n) && n.getType() === 'table');
      if (!table || !$isElementNode(table)) throw new Error('no table');
      const cell = table
        .getChildren()
        .filter($isTableRowNode)[1]!
        .getChildren()
        .filter($isTableCellNode)[0]!;
      const list = $createListNode('bullet');
      const item = $createListItemNode();
      item.append($createTextNode('item'));
      list.append(item);
      cell.clear();
      cell.append(list);
    });
    const id = cellId(session, 1, 0);
    doc.apply({ kind: 'setText', node: id, text: 'X' });
    expect(cellChildTypes(session, 1, 0)).toEqual(['list']);
    expect(
      read(session, () => {
        const table = $getRoot()
          .getChildren()
          .find((n) => $isElementNode(n) && n.getType() === 'table');
        return table?.getTextContent();
      })
    ).toContain('X');
  });

  it('setText on a list id writes the first item and keeps the list', () => {
    const { session } = setup('- one\n- two');
    const doc = new Doc(session);
    const listId = read(session, () => $getId($getRoot().getFirstChild()!));
    doc.apply({ kind: 'setText', node: listId!, text: 'X' });
    const list = read(session, () => {
      const node = $getRoot().getFirstChild();
      if (!node || !$isElementNode(node)) throw new Error('list was dropped');
      return {
        type: node.getType(),
        children: node.getChildren().map((child) => child.getType()),
        text: node.getTextContent(),
      };
    });
    expect(list.type).toBe('list');
    expect(list.children).toEqual(['listitem', 'listitem']);
    expect(list.text).toContain('X');
    expect(list.text).toContain('two');
    expect(read(session, () => validateEditorTree($getRoot()))).toEqual([]);
  });

  it('replaceText and moveNode still accept the table id', () => {
    const { session, doc } = makeTable([['H'], ['old']]);
    doc.apply({
      kind: 'replaceText',
      node: 't',
      find: 'old',
      to: 'new',
      scope: { kind: 'all' },
    });
    expect(read(session, () => $getRoot().getTextContent())).toContain('new');
    const introId = read(session, () => {
      const first = $getRoot().getFirstChild();
      return first ? ($getId(first) as string) : '';
    });
    doc.apply({ kind: 'moveNode', node: 't', at: { before: introId } });
    const types = read(session, () =>
      $getRoot()
        .getChildren()
        .map((child) => child.getType())
    );
    expect(types[0]).toBe('table');
  });
});
