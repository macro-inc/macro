import { $isTableCellNode, $isTableRowNode } from '@lexical/table';
import { $getId } from '@macro-inc/lexical-core/plugins/nodeIdPlugin';
import {
  $getRoot,
  $isElementNode,
  $isTextNode,
  type ElementNode,
  type LexicalNode,
} from 'lexical';
import { describe, expect, it } from 'vitest';
import { read, setup } from '../ai-toolkit/_test-helpers';
import type { LexicalSession } from '../ai-toolkit/session';
import { serializeWithXml } from '../utils';
import { Doc } from './doc';

function textRuns(session: LexicalSession, blockIdx = 0) {
  return read(session, () => {
    const block = $getRoot().getChildren()[blockIdx] as ElementNode;
    const runs: Array<{ text: string; bold: boolean; italic: boolean }> = [];
    const walk = (n: LexicalNode) => {
      if ($isTextNode(n))
        runs.push({
          text: n.getTextContent(),
          bold: n.hasFormat('bold'),
          italic: n.hasFormat('italic'),
        });
      if ($isElementNode(n)) for (const c of n.getChildren()) walk(c);
    };
    if (block) for (const c of block.getChildren()) walk(c);
    return runs;
  });
}

function childIds(session: LexicalSession, topLevelIndex = 0): string[] {
  return read(session, () => {
    const block = $getRoot().getChildren()[topLevelIndex] as ElementNode;
    return block.getChildren().map((c) => $getId(c) ?? '?');
  });
}

describe('Doc — text content writes', () => {
  it('insertText at the end of a formatted run stays plain (no format inheritance)', () => {
    const { session, ids } = setup('a **b**');
    const len = new Doc(session).textLength(ids[0]!);
    new Doc(session).apply({
      kind: 'insertText',
      node: ids[0]!,
      at: len,
      text: ' c',
    });
    const runs = textRuns(session);
    expect(runs.find((r) => r.text === 'b')?.bold).toBe(true);
    expect(runs.find((r) => r.text.includes('c'))?.bold).toBe(false);
  });

  it('insertText at offset 0 before a formatted run stays plain', () => {
    const { session, ids } = setup('**b** c');
    new Doc(session).apply({
      kind: 'insertText',
      node: ids[0]!,
      at: 0,
      text: 'a ',
    });
    expect(textRuns(session).find((r) => r.text.includes('a'))?.bold).toBe(
      false
    );
  });
});

describe('Doc — block type & lists', () => {
  it('setBlockType mints a fresh durable id (old id leaves the doc)', () => {
    const { session, ids } = setup('Title');
    const before = ids[0]!;
    new Doc(session).apply({
      kind: 'setBlockType',
      node: before,
      block: 'heading',
      level: 2,
    });
    const xml = serializeWithXml(session);
    expect(xml).toContain('<h2');
    expect(xml).not.toContain(`id="${before}"`);
  });

  it('a follow-up edit still resolves the old id after a type swap', () => {
    const { session, ids } = setup('Title');
    const doc = new Doc(session);
    doc.apply({
      kind: 'setBlockType',
      node: ids[0]!,
      block: 'heading',
      level: 2,
    });
    doc.apply({ kind: 'appendText', node: ids[0]!, text: '!' });
    expect(serializeWithXml(session)).toContain('Title!');
  });
});

describe('Doc — structure & refs', () => {
  it('inserts a block anchored to a decorator (hr) landing as its sibling', () => {
    const { session, ids } = setup('intro');
    const doc = new Doc(session);
    doc.apply({
      kind: 'insertNode',
      ref: 'hr',
      spec: { block: 'divider' },
      at: { after: ids[0]! },
    });
    doc.apply({
      kind: 'insertNode',
      ref: 'h',
      spec: { block: 'heading', level: 2, text: 'Section' },
      at: { after: 'hr' },
    });
    const out = serializeWithXml(session);
    expect(out.indexOf('<hr')).toBeLessThan(out.indexOf('<h2'));
  });

  it('appendListItem rejects a non-list target', () => {
    const { session, ids } = setup('para');
    expect(() =>
      new Doc(session).apply({
        kind: 'appendListItem',
        ref: 'x',
        node: ids[0]!,
        text: 'x',
      })
    ).toThrow(/not a list/);
  });

  it('appendListItem / prependListItem populate a list by its container id (even when empty)', () => {
    const { session, ids } = setup('intro');
    const doc = new Doc(session);
    doc.apply({
      kind: 'insertNode',
      ref: 'L',
      spec: { block: 'list', list: 'number', items: [] },
      at: { after: ids[0]! },
    });
    // empty list: no <li> to anchor on — must work off the <ol> id
    doc.apply({ kind: 'appendListItem', ref: 'a', node: 'L', text: 'middle' });
    doc.apply({ kind: 'appendListItem', ref: 'b', node: 'L', text: 'last' });
    doc.apply({ kind: 'prependListItem', ref: 'c', node: 'L', text: 'first' });
    const xml = serializeWithXml(session);
    expect((xml.match(/<ol/g) ?? []).length).toBe(1);
    expect(xml.indexOf('first')).toBeLessThan(xml.indexOf('middle'));
    expect(xml.indexOf('middle')).toBeLessThan(xml.indexOf('last'));
  });

  it('appendListItem on a check list creates an (unchecked) checkbox item', () => {
    const { session, ids } = setup('intro');
    const doc = new Doc(session);
    doc.apply({
      kind: 'insertNode',
      ref: 'L',
      spec: { block: 'list', list: 'check', items: [] },
      at: { after: ids[0]! },
    });
    doc.apply({ kind: 'appendListItem', ref: 'a', node: 'L', text: 'task' });
    // the appended item is a real checkbox item: toggling it renders checked.
    doc.apply({ kind: 'setChecked', node: 'a', checked: true });
    expect(serializeWithXml(session)).toMatch(/checked="true"/);
  });

  it('insertListItemAfter/Before add same-kind siblings into an existing list', () => {
    const { session, ids } = setup('intro');
    const doc = new Doc(session);
    doc.apply({
      kind: 'insertNode',
      ref: 'L',
      spec: { block: 'list', list: 'bullet', items: [] },
      at: { after: ids[0]! },
    });
    doc.apply({
      kind: 'appendListItem',
      ref: 'L~li-0',
      node: 'L',
      text: 'middle',
    });
    doc.apply({
      kind: 'insertListItemAfter',
      ref: 'after',
      node: 'L~li-0',
      text: 'last',
      list: 'bullet',
    });
    doc.apply({
      kind: 'insertListItemBefore',
      ref: 'before',
      node: 'L~li-0',
      text: 'first',
      list: 'bullet',
    });
    const xml = serializeWithXml(session);
    expect((xml.match(/<ul/g) ?? []).length).toBe(1);
    expect(xml.indexOf('first')).toBeLessThan(xml.indexOf('middle'));
    expect(xml.indexOf('middle')).toBeLessThan(xml.indexOf('last'));
  });

  it('insertListItemAfter with a differing kind nests a sublist', () => {
    const { session, ids } = setup('intro');
    const doc = new Doc(session);
    doc.apply({
      kind: 'insertNode',
      ref: 'L',
      spec: { block: 'list', list: 'bullet', items: [] },
      at: { after: ids[0]! },
    });
    doc.apply({
      kind: 'appendListItem',
      ref: 'L~li-0',
      node: 'L',
      text: 'bullet item',
    });
    doc.apply({
      kind: 'insertListItemAfter',
      ref: 'nested',
      node: 'L~li-0',
      text: 'numbered item',
      list: 'number',
    });
    expect(serializeWithXml(session)).toMatch(
      /<ul[\s\S]*<ol[\s\S]*numbered item[\s\S]*<\/ol>[\s\S]*<\/ul>/
    );
  });

  it('removeListItem rejects a non-list-item target', () => {
    const { session, ids } = setup('para');
    expect(() =>
      new Doc(session).apply({ kind: 'removeListItem', node: ids[0]! })
    ).toThrow(/not a list item/);
  });

  it('setCell rejects a <tr> id (must be the table)', () => {
    const { session, ids } = setup('intro');
    const doc = new Doc(session);
    doc.apply({
      kind: 'insertNode',
      ref: 't',
      spec: {
        block: 'table',
        rows: [
          ['A', 'B'],
          ['c', 'd'],
        ],
      },
      at: { after: ids[0]! },
    });
    const rowId = serializeWithXml(session).match(/<tr id="([^"]+)"/)?.[1];
    expect(rowId).toBeTruthy();
    expect(() =>
      doc.apply({ kind: 'setCell', table: rowId!, row: 0, col: 0, text: 'X' })
    ).toThrow(/not a table/);
  });
});

describe('Doc — readers', () => {
  it('cellNode resolves a cell content id whose text we can measure', () => {
    const { session, ids } = setup('x');
    const doc = new Doc(session);
    doc.apply({
      kind: 'insertNode',
      ref: 't',
      spec: { block: 'table', rows: [['Head'], ['body']] },
      at: { after: ids[0]! },
    });
    expect(doc.textLength(doc.cellNode('t', 1, 0))).toBe(4);
  });
});

describe('Doc — error surfacing', () => {
  it('an unknown id throws EditError', () => {
    const { session } = setup('hi');
    expect(() =>
      new Doc(session).apply({ kind: 'setText', node: 'nope', text: 'x' })
    ).toThrow(/No node with id|nope/);
  });

  it('a failed edit leaves the document untouched', () => {
    const { session, ids } = setup('safe');
    expect(() =>
      new Doc(session).apply({ kind: 'removeNode', node: 'ghost' })
    ).toThrow();
    expect(serializeWithXml(session)).toContain('safe');
    expect(serializeWithXml(session)).toContain(`id="${ids[0]}"`);
  });
});

describe('Doc.locate — within and across text nodes', () => {
  it('occurrences across two text runs report per-node (within-node) offsets', () => {
    const { session, ids } = setup('a **b** a');
    const matches = new Doc(session).locate(ids[0]!, 'a', { kind: 'all' });
    expect(matches).toHaveLength(2);
    expect(matches[0]).toMatchObject({ start: 0, end: 1 });
    expect(matches[1]).toMatchObject({ start: 1, end: 2 });
    expect(matches[0]!.node).not.toBe(matches[1]!.node);
  });

  it('node id is the text-node id (not the block id)', () => {
    const { session, ids } = setup('hello');
    const matches = new Doc(session).locate(ids[0]!, 'ell');
    expect(matches[0]!.node).not.toBe(ids[0]);
    expect(matches[0]).toMatchObject({ start: 1, end: 4 });
  });

  it("scope { kind: 'nth', n: 2 } returns only the 2nd occurrence", () => {
    const { session, ids } = setup('a a a');
    const m = new Doc(session).locate(ids[0]!, 'a', { kind: 'nth', n: 2 });
    expect(m).toHaveLength(1);
    expect(m[0]).toMatchObject({ start: 2, end: 3 });
  });

  it('nth counts across text-node boundaries', () => {
    const { session, ids } = setup('a **b** a');
    const m = new Doc(session).locate(ids[0]!, 'a', { kind: 'nth', n: 2 });
    expect(m).toHaveLength(1);
    expect(m[0]).toMatchObject({ start: 1, end: 2 });
  });
});

describe('Doc.insertText — multi-run formatting preservation', () => {
  it('inserting inside a plain run keeps adjacent bold run bold', () => {
    const { session, ids } = setup('**bold** plain');
    new Doc(session).apply({
      kind: 'insertText',
      node: ids[0]!,
      at: 6,
      text: 'Z',
    });
    expect(textRuns(session).find((r) => r.text === 'bold')?.bold).toBe(true);
    expect(serializeWithXml(session)).toContain('pZlain');
  });

  it('inserting inside a bold run stays bold', () => {
    const { session, ids } = setup('a **b** c');
    new Doc(session).apply({
      kind: 'insertText',
      node: ids[0]!,
      at: 3,
      text: 'X',
    });
    expect(textRuns(session).find((r) => r.text === 'bX')?.bold).toBe(true);
  });

  it('inserting at a run boundary lands in the earlier plain run', () => {
    const { session, ids } = setup('a **b** c');
    new Doc(session).apply({
      kind: 'insertText',
      node: ids[0]!,
      at: 2,
      text: 'X',
    });
    expect(textRuns(session).find((r) => r.text === 'b')?.bold).toBe(true);
    expect(serializeWithXml(session)).toContain('X');
  });
});

describe('Doc.removeText — slices and spans', () => {
  it('removes a range spanning two text nodes', () => {
    const { session, ids } = setup('a **b** c');
    new Doc(session).apply({
      kind: 'removeText',
      node: ids[0]!,
      at: 1,
      len: 3,
    });
    expect(serializeWithXml(session)).toContain('>a<');
    expect(serializeWithXml(session)).toContain('>c<');
    expect(serializeWithXml(session)).not.toContain('>b<');
  });
});

describe('Doc.insertInline — offset placement', () => {
  it('offset 0 inserts before the first run', () => {
    const { session, ids } = setup('hello');
    new Doc(session).apply({
      kind: 'insertInline',
      ref: 'r',
      node: ids[0]!,
      at: 0,
      spec: { inline: 'date', date: '2026-01-01' },
    });
    const out = serializeWithXml(session);
    expect(out.indexOf('2026-01-01')).toBeLessThan(out.indexOf('hello'));
  });

  it('a middle offset splits the run', () => {
    const { session, ids } = setup('hello');
    new Doc(session).apply({
      kind: 'insertInline',
      ref: 'r',
      node: ids[0]!,
      at: 2,
      spec: { inline: 'linebreak' },
    });
    expect(serializeWithXml(session)).toContain('<br');
    expect(serializeWithXml(session)).toContain('he');
    expect(serializeWithXml(session)).toContain('llo');
  });

  it('offset at the end appends after the last run', () => {
    const { session, ids } = setup('hello');
    new Doc(session).apply({
      kind: 'insertInline',
      ref: 'r',
      node: ids[0]!,
      at: 5,
      spec: { inline: 'date', date: '2026-01-01' },
    });
    const out = serializeWithXml(session);
    expect(out.indexOf('hello')).toBeLessThan(out.indexOf('2026-01-01'));
  });
});

describe('Doc — chained block-type swaps stay addressable by the original id', () => {
  it('paragraph → heading → quote → paragraph: original id still resolves throughout', () => {
    const { session, ids } = setup('Title');
    const id = ids[0]!;
    const doc = new Doc(session);
    doc.apply({ kind: 'setBlockType', node: id, block: 'heading', level: 2 });
    doc.apply({ kind: 'setBlockType', node: id, block: 'quote' });
    doc.apply({ kind: 'setBlockType', node: id, block: 'paragraph' });
    doc.apply({ kind: 'appendText', node: id, text: '!' });
    expect(serializeWithXml(session)).toContain('Title!');
    expect(serializeWithXml(session)).not.toContain(`id="${id}"`);
  });

  it('a child node stays addressable by its own id after the parent is swapped', () => {
    const { session, ids } = setup('hello world');
    const doc = new Doc(session);
    const childId = read(session, () =>
      $getId(($getRoot().getFirstChild() as ElementNode).getFirstChild()!)
    )!;
    doc.apply({
      kind: 'setBlockType',
      node: ids[0]!,
      block: 'heading',
      level: 2,
    });
    doc.apply({ kind: 'formatNode', node: childId, format: 'bold', on: true });
    const xml = serializeWithXml(session);
    expect(xml).toContain('<h2');
    expect(xml).toContain('bold="true"');
  });
});

describe('Doc.setListType — preserves item ids', () => {
  it('toggling a paragraph into a list produces an addressable item', () => {
    const { session, ids } = setup('one');
    const doc = new Doc(session);
    doc.apply({ kind: 'setListType', nodes: [ids[0]!], list: 'bullet' });
    const itemId = childIds(session)[0]!;
    doc.apply({ kind: 'appendText', node: itemId, text: '!' });
    expect(serializeWithXml(session)).toContain('one!');
  });

  it('switching bullet → numbered keeps every item id', () => {
    const { session } = setup('- one\n- two');
    const before = childIds(session);
    new Doc(session).apply({
      kind: 'setListType',
      nodes: [before[0]!],
      list: 'number',
    });
    expect(childIds(session)).toEqual(before);
    expect(serializeWithXml(session)).toContain('<ol');
  });

  it('retypes a list addressed by its container id (the <ul>/<ol>)', () => {
    const { session, ids } = setup('- one\n- two');
    new Doc(session).apply({
      kind: 'setListType',
      nodes: [ids[0]!],
      list: 'number',
    });
    const xml = serializeWithXml(session);
    expect(xml).toContain('<ol');
    expect(xml).not.toContain('<ul');
  });
});

describe('Doc — ref resolution', () => {
  it('inserting two blocks mints two distinct addressable ids', () => {
    const { session, ids } = setup('first');
    const doc = new Doc(session);
    doc.apply({
      kind: 'insertNode',
      ref: 'a',
      spec: { block: 'paragraph', text: 'AA' },
      at: { after: ids[0]! },
    });
    doc.apply({
      kind: 'insertNode',
      ref: 'b',
      spec: { block: 'paragraph', text: 'BB' },
      at: { after: ids[0]! },
    });
    doc.apply({ kind: 'appendText', node: 'a', text: '1' });
    doc.apply({ kind: 'appendText', node: 'b', text: '2' });
    const out = serializeWithXml(session);
    expect(out).toContain('AA1');
    expect(out).toContain('BB2');
  });
});

describe('Doc — tables', () => {
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

  it('setCell each cell of a 2x2 table', () => {
    const { session, doc } = makeTable([
      ['H1', 'H2'],
      ['a', 'b'],
    ]);
    doc.apply({ kind: 'setCell', table: 't', row: 0, col: 1, text: 'HX' });
    doc.apply({ kind: 'setCell', table: 't', row: 1, col: 0, text: 'AA' });
    doc.apply({ kind: 'setCell', table: 't', row: 1, col: 1, text: 'BB' });
    const out = serializeWithXml(session);
    expect(out).toContain('H1');
    expect(out).toContain('HX');
    expect(out).toContain('AA');
    expect(out).toContain('BB');
  });

  it('cellNode resolves and textLength matches the cell content', () => {
    const { doc } = makeTable([['Head'], ['body']]);
    expect(doc.textLength(doc.cellNode('t', 0, 0))).toBe(4);
    expect(doc.textLength(doc.cellNode('t', 1, 0))).toBe(4);
  });

  it('addRow appends a row with the right column count', () => {
    const { session, doc } = makeTable([
      ['H1', 'H2'],
      ['a', 'b'],
    ]);
    doc.apply({ kind: 'addRow', table: 't' });
    expect(rowCellCounts(session)).toEqual([2, 2, 2]);
  });

  it('addRow at an index inserts before that row', () => {
    const { session, doc } = makeTable([
      ['H1', 'H2'],
      ['a', 'b'],
    ]);
    doc.apply({ kind: 'addRow', table: 't', at: 1 });
    doc.apply({ kind: 'setCell', table: 't', row: 1, col: 0, text: 'mid' });
    expect(serializeWithXml(session)).toContain('mid');
    expect(rowCellCounts(session)).toEqual([2, 2, 2]);
  });

  it('addColumn gives every row a new cell; header-row cell is a header', () => {
    const { session, doc } = makeTable([
      ['H1', 'H2'],
      ['a', 'b'],
    ]);
    doc.apply({ kind: 'addColumn', table: 't' });
    expect(rowCellCounts(session)).toEqual([3, 3]);
    const headerStates = read(session, () =>
      tableRows(session)[0]!
        .getChildren()
        .filter($isTableCellNode)
        .map((c) => c.getHeaderStyles())
    );
    expect(headerStates.at(-1)).not.toBe(0);
  });

  it('removeRow drops a row', () => {
    const { session, doc } = makeTable([
      ['H1', 'H2'],
      ['a', 'b'],
      ['c', 'd'],
    ]);
    doc.apply({ kind: 'removeRow', table: 't', row: 2 });
    expect(rowCellCounts(session)).toHaveLength(2);
    expect(serializeWithXml(session)).not.toContain('>c<');
    expect(serializeWithXml(session)).not.toContain('>d<');
  });

  it('removeColumn drops the column from every row', () => {
    const { session, doc } = makeTable([
      ['H1', 'H2', 'H3'],
      ['aa', 'bb', 'cc'],
    ]);
    doc.apply({ kind: 'removeColumn', table: 't', col: 1 });
    expect(rowCellCounts(session)).toEqual([2, 2]);
    // assert on actual cell text, not raw XML: random node ids can contain the
    // substring 'H2', which would make a `not.toContain('H2')` check flaky.
    expect(cellTexts(session)).toEqual([
      ['H1', 'H3'],
      ['aa', 'cc'],
    ]);
  });
});

function cellTexts(session: LexicalSession): string[][] {
  return read(session, () =>
    tableRows(session).map((row) =>
      row
        .getChildren()
        .filter($isTableCellNode)
        .map((cell) => cell.getTextContent())
    )
  );
}

function tableRows(session: LexicalSession) {
  return read(session, () => {
    let table: LexicalNode | undefined;
    const walk = (n: LexicalNode) => {
      if (n.getType() === 'table') table = n;
      if ($isElementNode(n)) for (const c of n.getChildren()) walk(c);
    };
    for (const c of $getRoot().getChildren()) walk(c);
    return (table as ElementNode).getChildren().filter($isTableRowNode);
  });
}

function rowCellCounts(session: LexicalSession): number[] {
  return read(session, () => {
    let table: LexicalNode | undefined;
    const walk = (n: LexicalNode) => {
      if (n.getType() === 'table') table = n;
      if ($isElementNode(n)) for (const c of n.getChildren()) walk(c);
    };
    for (const c of $getRoot().getChildren()) walk(c);
    return (table as ElementNode)
      .getChildren()
      .filter($isTableRowNode)
      .map((r) => r.getChildren().filter($isTableCellNode).length);
  });
}

describe('Doc — error surfacing & atomicity', () => {
  it('a failed insert (unknown anchor) leaves the doc untouched', () => {
    const { session, ids } = setup('safe');
    const doc = new Doc(session);
    expect(() =>
      doc.apply({
        kind: 'insertNode',
        ref: 'r',
        spec: { block: 'paragraph', text: 'x' },
        at: { after: 'ghost' },
      })
    ).toThrow();
    expect(serializeWithXml(session)).toContain('safe');
    expect(serializeWithXml(session)).toContain(`id="${ids[0]}"`);
  });

  it('cellNode on a missing cell throws EditError', () => {
    const { session, ids } = setup('intro');
    const doc = new Doc(session);
    doc.apply({
      kind: 'insertNode',
      ref: 't',
      spec: { block: 'table', rows: [['A']] },
      at: { after: ids[0]! },
    });
    expect(() => doc.cellNode('t', 9, 9)).toThrow();
  });

  it('a failed setCell leaves the table untouched', () => {
    const { session, ids } = setup('intro');
    const doc = new Doc(session);
    doc.apply({
      kind: 'insertNode',
      ref: 't',
      spec: {
        block: 'table',
        rows: [
          ['A', 'B'],
          ['c', 'd'],
        ],
      },
      at: { after: ids[0]! },
    });
    const before = serializeWithXml(session);
    expect(() =>
      doc.apply({ kind: 'setCell', table: 't', row: 9, col: 9, text: 'x' })
    ).toThrow();
    expect(serializeWithXml(session)).toBe(before);
  });
});
