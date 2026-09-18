import { $isTableCellNode, $isTableRowNode } from '@lexical/table';
import { $getId } from '@macro-inc/lexical-core/plugins/nodeIdPlugin';
import { $getRoot, $isElementNode } from 'lexical';
import { describe, expect, it } from 'vitest';
import { Doc } from '../doc/doc';
import { edit, read, setup } from './_test-helpers';
import { $blockById, $byId } from './locate';

describe('lock-on + errors', () => {
  it('$byId throws EditError on a missing id', () => {
    const { session } = setup('hello');
    edit(session, () => {
      expect(() => $byId(session, 'nope-missing')).toThrowError(Error);
    });
  });

  it('$blockById throws EditError on a missing id', () => {
    const { session } = setup('hello');
    edit(session, () => {
      expect(() => $blockById(session, 'nope-missing')).toThrowError(Error);
    });
  });

  it('$blockById resolves an inline (text) id up to its containing block', () => {
    const { session } = setup('hello world');
    // the text node's id (a child of the block)
    const textId = read(session, () => {
      const block = $getRoot().getFirstChild();
      const text = $isElementNode(block) ? block.getFirstChild() : null;
      return text ? $getId(text) : null;
    });
    expect(textId).toBeTruthy();
    edit(session, () => {
      const block = $blockById(session, textId!);
      expect($isElementNode(block)).toBe(true);
      expect(block.getType()).toBe('paragraph');
    });
  });

  it('$blockById on a <td> id resolves to the cell paragraph', () => {
    const { session, ids } = setup('intro');
    new Doc(session).apply({
      kind: 'insertNode',
      ref: 't',
      spec: { block: 'table', rows: [['H'], ['a']] },
      at: { after: ids[0]! },
    });
    const id = read(session, () => {
      const table = $getRoot()
        .getChildren()
        .find((n) => $isElementNode(n) && n.getType() === 'table');
      if (!table || !$isElementNode(table)) throw new Error('no table');
      const cell = table
        .getChildren()
        .filter($isTableRowNode)[1]!
        .getChildren()
        .filter($isTableCellNode)[0]!;
      return $getId(cell);
    });
    edit(session, () => {
      expect($blockById(session, id!).getType()).toBe('paragraph');
    });
  });

  it('$blockById on a table or row id resolves to that node', () => {
    const { session, ids } = setup('intro');
    new Doc(session).apply({
      kind: 'insertNode',
      ref: 't',
      spec: { block: 'table', rows: [['H'], ['a']] },
      at: { after: ids[0]! },
    });
    edit(session, () => {
      expect($blockById(session, 't').getType()).toBe('table');
      const table = $getRoot()
        .getChildren()
        .find((n) => $isElementNode(n) && n.getType() === 'table');
      if (!table || !$isElementNode(table)) throw new Error('no table');
      const row = table.getChildren().filter($isTableRowNode)[0]!;
      expect($blockById(session, $getId(row)!).getType()).toBe('tablerow');
    });
  });
});
