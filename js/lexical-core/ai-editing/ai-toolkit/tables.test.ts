import { $createTextNode, $getRoot } from 'lexical';
import { $isTableNode } from '@lexical/table';
import { describe, expect, it } from 'vitest';
import { $getId } from '../../plugins/nodeIdPlugin';
import { $blockNode } from './blocks';
import { $byId } from './locate';
import { $setCell, $table } from './tables';
import { removeLinePrefix, edit, read, setup } from './_test-helpers';

// ============================================================================
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
    const out = removeLinePrefix(s);
    expect(out).toContain('| Fruit | Taste |');
    expect(out).toContain('| Apple | Sweet |');
    expect(out).toContain('| Lemon | Sour |');
  });
});

// ============================================================================
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
    const out = removeLinePrefix(s);
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

// ============================================================================
describe('$table / $setCell node flexibility', () => {
  it('a cell can be a node you build (e.g. bold text), not just a string', () => {
    const { s, ids } = setup('intro');
    edit(s, () => {
      const para = $blockNode('paragraph');
      para.append($createTextNode('Apple').toggleFormat('bold'));
      $byId(s, ids[0]).insertAfter($table([[para]]));
    });
    // the paragraph we built is used as-is — the cell's text node is bold
    const isBold = read(s, () => {
      const table = $getRoot().getChildren()[1] as any;
      const text = table.getChildren()[0].getChildren()[0].getChildren()[0].getChildren()[0];
      return text.hasFormat('bold');
    });
    expect(isBold).toBe(true);
  });
});
