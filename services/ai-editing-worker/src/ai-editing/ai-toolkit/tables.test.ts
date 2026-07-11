import { $isTableNode, type TableNode } from '@lexical/table';
import { $getId } from '@lexical-core/plugins/nodeIdPlugin';
import {
  $createTextNode,
  $getRoot,
  $isTextNode,
  type ElementNode,
} from 'lexical';
import { describe, expect, it } from 'vitest';
import { serializeWithXml } from '../utils';
import { edit, read, setup } from './_test-helpers';
import { $blockNode } from './blocks';
import { $byId } from './locate';
import { $setCell, $table } from './tables';

describe('$table', () => {
  it('builds a real TableNode that serializes to XML with table structure', () => {
    const { session, ids } = setup('intro');
    edit(session, () =>
      $byId(session, ids[0]).insertAfter(
        $table([
          ['Fruit', 'Taste'],
          ['Apple', 'Sweet'],
          ['Lemon', 'Sour'],
        ])
      )
    );
    expect(
      read(session, () => $getRoot().getChildren().some($isTableNode))
    ).toBe(true);
    const xml = serializeWithXml(session);
    expect(xml).toContain('<table');
    expect(xml).toContain('Fruit');
    expect(xml).toContain('Taste');
    expect(xml).toContain('Apple');
    expect(xml).toContain('Sweet');
    expect(xml).toContain('Lemon');
    expect(xml).toContain('Sour');
  });
});

describe('$setCell', () => {
  it('edits a single cell in place (0-based, header is row 0)', () => {
    const { session, ids } = setup('intro');
    edit(session, () =>
      $byId(session, ids[0]).insertAfter(
        $table([
          ['Fruit', 'Taste'],
          ['Apple', 'Sweet'],
        ])
      )
    );
    const tableId = read(session, () => $getId($getRoot().getChildren()[1]!));
    edit(session, () => $setCell($byId(session, tableId!), 1, 0, 'Banana')); // Apple -> Banana
    const xml = serializeWithXml(session);
    expect(xml).toContain('Banana');
    expect(xml).not.toContain('Apple');
  });

  it('throws on an out-of-range cell', () => {
    const { session, ids } = setup('intro');
    edit(session, () =>
      $byId(session, ids[0]).insertAfter($table([['a', 'b']]))
    );
    const tableId = read(session, () => $getId($getRoot().getChildren()[1]!));
    edit(session, () => {
      expect(() => $setCell($byId(session, tableId!), 9, 9, 'x')).toThrowError(
        Error
      );
    });
  });
});

describe('$table / $setCell node flexibility', () => {
  it('a cell can be a node you build (e.g. bold text), not just a string', () => {
    const { session, ids } = setup('intro');
    edit(session, () => {
      const para = $blockNode({ type: 'paragraph' });
      para.append($createTextNode('Apple').toggleFormat('bold'));
      $byId(session, ids[0]).insertAfter($table([[para]]));
    });
    // the paragraph we built is used as-is — the cell's text node is bold
    const isBold = read(session, () => {
      const table = $getRoot().getChildren()[1] as TableNode;
      const row = table.getFirstChild() as ElementNode; // TableRowNode
      const cell = row.getFirstChild() as ElementNode; // TableCellNode
      const para = cell.getFirstChild() as ElementNode; // ParagraphNode
      const text = para.getFirstChild();
      return $isTextNode(text) && text.hasFormat('bold');
    });
    expect(isBold).toBe(true);
  });
});
