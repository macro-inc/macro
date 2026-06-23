import { $createTextNode, $getRoot, $isTextNode, type ElementNode } from 'lexical';
import { $isTableNode, type TableNode } from '@lexical/table';
import { describe, expect, it } from 'vitest';
import { $getId } from '../../../../lexical-core/plugins/nodeIdPlugin';
import { $blockNode } from './blocks';
import { $byId } from './locate';
import { $setCell, $table } from './tables';
import { serializedWithoutLinePrefix, edit, read, setup } from './_test-helpers';

describe('$table', () => {
  it('builds a real TableNode that serializes back to pipe markdown', () => {
    const { s, ids } = setup('intro');
    edit(s, () =>
      $byId(s, ids[0]).insertAfter(
        $table([
          ['Fruit', 'Taste'],
          ['Apple', 'Sweet'],
          ['Lemon', 'Sour'],
        ])
      )
    );
    expect(read(s, () => $getRoot().getChildren().some($isTableNode))).toBe(true);
    const out = serializedWithoutLinePrefix(s);
    expect(out).toContain('| Fruit | Taste |');
    expect(out).toContain('| Apple | Sweet |');
    expect(out).toContain('| Lemon | Sour |');
  });
});

describe('$setCell', () => {
  it('edits a single cell in place (0-based, header is row 0)', () => {
    const { s, ids } = setup('intro');
    edit(s, () =>
      $byId(s, ids[0]).insertAfter(
        $table([
          ['Fruit', 'Taste'],
          ['Apple', 'Sweet'],
        ])
      )
    );
    const tableId = read(s, () => $getId($getRoot().getChildren()[1]!));
    edit(s, () => $setCell($byId(s, tableId!), 1, 0, 'Banana')); // Apple -> Banana
    const out = serializedWithoutLinePrefix(s);
    expect(out).toContain('| Banana | Sweet |');
    expect(out).not.toContain('Apple');
  });

  it('throws on an out-of-range cell', () => {
    const { s, ids } = setup('intro');
    edit(s, () => $byId(s, ids[0]).insertAfter($table([['a', 'b']])));
    const tableId = read(s, () => $getId($getRoot().getChildren()[1]!));
    edit(s, () => {
      expect(() => $setCell($byId(s, tableId!), 9, 9, 'x')).toThrowError(Error);
    });
  });
});

describe('$table / $setCell node flexibility', () => {
  it('a cell can be a node you build (e.g. bold text), not just a string', () => {
    const { s, ids } = setup('intro');
    edit(s, () => {
      const para = $blockNode({ type: 'paragraph' });
      para.append($createTextNode('Apple').toggleFormat('bold'));
      $byId(s, ids[0]).insertAfter($table([[para]]));
    });
    // the paragraph we built is used as-is — the cell's text node is bold
    const isBold = read(s, () => {
      const table = $getRoot().getChildren()[1] as TableNode;
      const row = table.getFirstChild() as ElementNode;       // TableRowNode
      const cell = row.getFirstChild() as ElementNode;        // TableCellNode
      const para = cell.getFirstChild() as ElementNode;       // ParagraphNode
      const text = para.getFirstChild();
      return $isTextNode(text) && text.hasFormat('bold');
    });
    expect(isBold).toBe(true);
  });
});
