import { $getId } from '@macro-inc/lexical-core/plugins/nodeIdPlugin';
import { $getRoot, $isElementNode } from 'lexical';
import { describe, expect, it, vi } from 'vitest';
import { read, setup } from '../ai-toolkit/_test-helpers';
import { type DocumentOp, EditError } from '../editor';
import { Doc } from './doc';

const textWrites: DocumentOp[] = [
  { kind: 'setText', node: '', text: 'X' },
  { kind: 'appendText', node: '', text: 'X' },
  { kind: 'prependText', node: '', text: 'X' },
  { kind: 'insertText', node: '', at: 0, text: 'X' },
  {
    kind: 'insertInline',
    node: '',
    at: 0,
    ref: 'break',
    spec: { inline: 'linebreak' },
  },
  { kind: 'setBlockType', node: '', block: 'heading', level: 2 },
];

function tableFixture(text = 'original') {
  const { session, ids } = setup('intro\n\n- one\n- two');
  const propagate = vi.fn();
  const doc = new Doc(session, propagate);
  doc.apply({
    kind: 'insertNode',
    ref: 'table',
    spec: { block: 'table', rows: [[text]] },
    at: { after: ids[0]! },
  });
  const targets = read(session, () => {
    const table = $getRoot()
      .getChildren()
      .find((n) => n.getType() === 'table');
    if (!$isElementNode(table)) throw new Error('missing table');
    const row = table.getFirstChild();
    if (!$isElementNode(row)) throw new Error('missing row');
    const cell = row.getFirstChild();
    if (!$isElementNode(cell)) throw new Error('missing cell');
    const paragraph = cell.getFirstChild()!;
    const list = $getRoot()
      .getChildren()
      .find((n) => n.getType() === 'list');
    if (!$isElementNode(list)) throw new Error('missing list');
    return {
      table: 'table',
      row: $getId(row)!,
      cell: $getId(cell)!,
      list: $getId(list)!,
      paragraph: $getId(paragraph)!,
      item: $getId(list.getFirstChild()!)!,
    };
  });
  propagate.mockClear();
  return { session, doc, targets, propagate, intro: ids[0]! };
}

describe('text writers reject container ids before changing content', () => {
  for (const target of ['table', 'row', 'cell', 'list'] as const) {
    for (const op of textWrites) {
      it(`${op.kind} rejects a ${target} id, including when empty`, () => {
        for (const text of ['original', '']) {
          const { session, doc, targets, propagate } = tableFixture(text);
          const before = session.editor.getEditorState().toJSON();
          const apply = () =>
            doc.apply({ ...op, node: targets[target] } as DocumentOp);
          expect(apply).toThrow(EditError);
          expect(apply).toThrow('target a paragraph or list item id');
          expect(session.editor.getEditorState().toJSON()).toEqual(before);
          expect(propagate).not.toHaveBeenCalled();
        }
      });
    }
  }

  for (const target of ['paragraph', 'item'] as const) {
    for (const op of textWrites) {
      it(`${op.kind} still accepts a ${target} id`, () => {
        const { doc, targets, propagate } = tableFixture();
        expect(() =>
          doc.apply({ ...op, node: targets[target] } as DocumentOp)
        ).not.toThrow();
        expect(propagate).toHaveBeenCalledOnce();
      });
    }
  }

  it('keeps setCell, container search/replace, and table moves working', () => {
    const { session, doc, targets, intro } = tableFixture();
    doc.apply({
      kind: 'setCell',
      table: targets.table,
      row: 0,
      col: 0,
      text: 'updated',
    });
    expect(doc.locate(targets.cell, 'updated')).toHaveLength(1);
    doc.apply({
      kind: 'replaceText',
      node: targets.table,
      find: 'updated',
      to: 'replaced',
      scope: { kind: 'all' },
    });
    doc.apply({ kind: 'moveNode', node: targets.table, at: { before: intro } });
    read(session, () => {
      expect($getRoot().getFirstChild()?.getType()).toBe('table');
      expect($getRoot().getTextContent()).toContain('replaced');
    });
  });
});
