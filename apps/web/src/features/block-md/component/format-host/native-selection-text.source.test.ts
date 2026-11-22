import { $createListItemNode, $createListNode } from '@lexical/list';
import {
  $createTableNodeWithDimensions,
  $createTableSelectionFrom,
  $isTableCellNode,
  $isTableNode,
  $isTableRowNode,
} from '@lexical/table';
import { NodeReplacements, SupportedNodeTypes } from '@macro-inc/lexical-core';
import {
  $createNodeSelection,
  $createParagraphNode,
  $createRangeSelection,
  $createTextNode,
  $getRoot,
  $getSelection,
  $isElementNode,
  $setSelection,
  createEditor,
} from 'lexical';
import { expect, test } from 'vitest';

test('Source plain selection text preserves Unicode boundaries and list/table/null/node semantics', () => {
  const editor = createEditor({
    nodes: [...SupportedNodeTypes, ...NodeReplacements],
    onError(error) {
      throw error;
    },
  });
  let first = '',
    second = '',
    item = '',
    list = '',
    table = '';
  editor.update(
    () => {
      const a = $createTextNode('a😀b'),
        b = $createTextNode('second');
      const l = $createListNode('bullet'),
        li = $createListItemNode(),
        t = $createTextNode('item');
      li.append(t);
      l.append(li);
      const grid = $createTableNodeWithDimensions(1, 2, false);
      const row = grid.getFirstChildOrThrow();
      if (!$isTableRowNode(row)) throw new Error('Actual row missing');
      const cells = row.getChildren();
      for (const [i, cell] of cells.entries()) {
        if (!$isTableCellNode(cell)) throw new Error('Actual cell missing');
        const p = cell.getFirstChildOrThrow();
        if (!$isElementNode(p)) throw new Error('Actual paragraph missing');
        p.append($createTextNode(i === 0 ? 'A' : 'B'));
      }
      $getRoot().append(
        $createParagraphNode().append(a),
        $createParagraphNode().append(b),
        l,
        grid
      );
      first = a.getKey();
      second = b.getKey();
      item = t.getKey();
      list = l.getKey();
      table = grid.getKey();
    },
    { discrete: true }
  );
  const range = (a: string, x: number, b: string, y: number) => {
    const s = $createRangeSelection();
    s.anchor.set(a, x, 'text');
    s.focus.set(b, y, 'text');
    return s;
  };
  const actual: string[] = [];
  for (const kind of [
    'null',
    'collapsed',
    'forward',
    'backward',
    'list',
    'node',
    'table',
  ]) {
    editor.update(
      () => {
        if (kind === 'null') $setSelection(null);
        if (kind === 'collapsed') $setSelection(range(first, 1, first, 1));
        if (kind === 'forward') $setSelection(range(first, 1, second, 3));
        if (kind === 'backward') $setSelection(range(second, 3, first, 1));
        if (kind === 'list') $setSelection(range(item, 0, item, 4));
        if (kind === 'node') {
          const s = $createNodeSelection();
          s.add(list);
          $setSelection(s);
        }
        if (kind === 'table') {
          const s = $createRangeSelection();
          $setSelection(s);
          // Actual table selection API resolves the current registered nodes.
          const root = $getRoot(),
            grid = root.getLastChildOrThrow();
          if (!$isTableNode(grid) || grid.getKey() !== table)
            throw new Error('Actual table missing');
          const row = grid.getFirstChildOrThrow();
          if (!$isTableRowNode(row)) throw new Error('Actual row missing');
          const cells = row.getChildren();
          const [a, b] = cells;
          if (!$isTableCellNode(a) || !$isTableCellNode(b))
            throw new Error('Actual cells missing');
          $setSelection($createTableSelectionFrom(grid, a, b));
        }
        actual.push($getSelection()?.getTextContent() ?? '');
      },
      { discrete: true }
    );
  }
  expect(actual).toEqual([
    '',
    '',
    '😀b\nsec',
    '😀b\nsec',
    'item',
    'item',
    'A\tB\n',
  ]);
});
