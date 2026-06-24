import { describe, expect, it } from 'vitest';
import {
  $getRoot,
  $isElementNode,
  type ElementNode,
  type LexicalNode,
} from 'lexical';
import { $isMarkNode } from '@lexical/mark';
import { $isTableCellNode, $isTableRowNode } from '@lexical/table';
import { $getId } from '../../../../lexical-core/plugins/nodeIdPlugin';
import { edit, read, setup } from '../ai-toolkit/_test-helpers';
import { serializeWithIds, serializeWithXml } from '../utils';
import { applyEdit } from '../queue/runner';
import type { Session } from '../ai-toolkit/session';
import { Doc, buildNode } from './doc';

/** Serialize, stripping the `N | ` line-number prefix for stable assertions. */
function plain(s: Session): string {
  return serializeWithIds(s)
    .split('\n')
    .map((l) => l.replace(/^\d+ \| /, ''))
    .join('\n');
}

describe('Doc — text content writes', () => {
  it('insertText splices in place, preserving the block id', () => {
    const { s, ids } = setup('hello world');
    new Doc(s).insertText(ids[0]!, 5, ' there');
    expect(plain(s)).toBe(`hello there world {${ids[0]}|paragraph}`);
  });

  it('removeText deletes a range', () => {
    const { s, ids } = setup('hello world');
    new Doc(s).removeText(ids[0]!, 5, 6); // remove " world"
    expect(plain(s)).toBe(`hello {${ids[0]}|paragraph}`);
  });

  it('setText replaces content and strips formatting', () => {
    const { s, ids } = setup('the **bold** thing');
    new Doc(s).setText(ids[0]!, 'plain now');
    expect(plain(s)).toBe(`plain now {${ids[0]}|paragraph}`);
  });

  it('insertText at the end of a formatted run stays plain (no format inheritance)', () => {
    const { s, ids } = setup('a **b**'); // ends in a bold run
    const len = new Doc(s).textLength(ids[0]!);
    new Doc(s).insertText(ids[0]!, len, ' c');
    expect(plain(s)).toBe(`a **b** c {${ids[0]}|paragraph}`); // not `a **b c**`
  });

  it('insertText at offset 0 before a formatted run stays plain', () => {
    const { s, ids } = setup('**b** c'); // starts with a bold run
    new Doc(s).insertText(ids[0]!, 0, 'a ');
    expect(plain(s)).toBe(`a **b** c {${ids[0]}|paragraph}`); // not `**a b** c`
  });

  it('typing char-by-char into an emptied block builds the text', () => {
    const { s, ids } = setup('x');
    const doc = new Doc(s);
    doc.removeText(ids[0]!, 0, 1);
    for (const [i, ch] of [...'Hi'].entries()) doc.insertText(ids[0]!, i, ch);
    expect(plain(s)).toBe(`Hi {${ids[0]}|paragraph}`);
  });
});

describe('Doc — inline formatting (reuses ai-toolkit)', () => {
  it('formatText bolds every occurrence', () => {
    const { s, ids } = setup('the Bluejay and the Bluejay');
    new Doc(s).formatText(ids[0]!, 'Bluejay', 'bold', true, { all: true });
    expect(plain(s)).toBe(
      `the **Bluejay** and the **Bluejay** {${ids[0]}|paragraph}`
    );
  });

  it('formatText off clears that format on a match', () => {
    const { s, ids } = setup('the **Bluejay** launch');
    new Doc(s).formatText(ids[0]!, 'Bluejay', 'bold', false, { all: true });
    expect(plain(s)).toBe(`the Bluejay launch {${ids[0]}|paragraph}`);
  });

  it('markText on highlights (wraps in a mark node); off is a no-op when not highlighted', () => {
    const { s, ids } = setup('warn here');
    expect(() => new Doc(s).markText(ids[0]!, 'warn', false, {})).not.toThrow();
    new Doc(s).markText(ids[0]!, 'warn', true, {});
    const hasMark = read(s, () => {
      let found = false;
      const walk = (n: LexicalNode) => {
        if ($isMarkNode(n)) found = true;
        if ('getChildren' in n)
          for (const c of (n as any).getChildren()) walk(c);
      };
      for (const c of $getRoot().getChildren()) walk(c);
      return found;
    });
    expect(hasMark).toBe(true);
  });

  it('linkText wraps; unlink (null) removes the link wrapper', () => {
    const { s, ids } = setup('see docs');
    expect(() => new Doc(s).linkText(ids[0]!, 'docs', null, {})).not.toThrow();
    new Doc(s).linkText(ids[0]!, 'docs', 'http://x', {});
    expect(plain(s)).toContain('[docs](http://x)');
  });
});

describe('Doc — block type & lists (id preservation)', () => {
  it('setBlockType heading keeps the durable id', () => {
    const { s, ids } = setup('Title');
    const before = ids[0]!;
    new Doc(s).setBlockType(before, 'heading', { level: 2 });
    expect(plain(s)).toBe(`## Title {${before}|heading}`);
  });

  it('a follow-up edit still resolves the id after a type swap', () => {
    const { s, ids } = setup('Title');
    const doc = new Doc(s);
    doc.setBlockType(ids[0]!, 'heading', { level: 2 });
    doc.appendText(ids[0]!, '!'); // same id resolves to the new heading
    expect(plain(s)).toBe(`## Title! {${ids[0]}|heading}`);
  });

  it('setChecked operates on a list item (addressed by its own id)', () => {
    const { s } = setup('- [ ] todo');
    // top-level id is the list; the AI addresses the *item* by its id.
    const itemId = read(s, () =>
      $getId(
        (
          $getRoot().getFirstChild() as ElementNode
        ).getFirstChild() as LexicalNode
      )
    );
    new Doc(s).setChecked(itemId!, true);
    expect(plain(s)).toContain('[x]');
  });
});

describe('Doc — structure & refs', () => {
  it('insertNode mints an id resolvable by a follow-up edit via its ref', () => {
    const { s, ids } = setup('first');
    const doc = new Doc(s);
    doc.insertNode(
      'ref-1',
      { block: 'paragraph', text: 'second' },
      { after: ids[0]! }
    );
    doc.setText('ref-1', 'SECOND');
    const out = plain(s);
    expect(out).toContain('first');
    expect(out).toContain('SECOND');
  });

  it('removeNode deletes a block', () => {
    const { s, ids } = setup('keep\n\ndrop');
    new Doc(s).removeNode(ids[1]!);
    expect(plain(s)).toBe(`keep {${ids[0]}|paragraph}`);
  });

  it('appendListItem grows an empty list, each item typed via its ref', () => {
    // Mirrors how the animator builds a list: insert empty, then append + type.
    const { s, ids } = setup('intro');
    const doc = new Doc(s);
    doc.insertNode(
      'L',
      { block: 'list', list: 'bullet', items: [] },
      { after: ids[0]! }
    );
    doc.appendListItem('L~li-0', 'L');
    doc.setText('L~li-0', 'first');
    doc.appendListItem('L~li-1', 'L');
    doc.setText('L~li-1', 'second');
    const out = plain(s);
    expect(out).toContain('first');
    expect(out).toContain('second');
  });

  it('appendListItem rejects a non-list target', () => {
    const { s, ids } = setup('para');
    expect(() => new Doc(s).appendListItem('x', ids[0]!)).toThrow(/not a list/);
  });

  it('insertListItemAfter/Before add same-kind siblings into an existing list', () => {
    const { s, ids } = setup('intro');
    const doc = new Doc(s);
    doc.insertNode(
      'L',
      { block: 'list', list: 'bullet', items: [] },
      { after: ids[0]! }
    );
    doc.appendListItem('L~li-0', 'L');
    doc.setText('L~li-0', 'middle');
    doc.insertListItemAfter('after', 'L~li-0', 'last', 'bullet');
    doc.insertListItemBefore('before', 'L~li-0', 'first', 'bullet');
    const xml = serializeWithXml(s);
    // One list, three plain items in order, no nesting.
    expect((xml.match(/<ul/g) ?? []).length).toBe(1);
    expect(xml.indexOf('first')).toBeLessThan(xml.indexOf('middle'));
    expect(xml.indexOf('middle')).toBeLessThan(xml.indexOf('last'));
  });

  it('insertListItemAfter with a differing kind nests a sublist', () => {
    const { s, ids } = setup('intro');
    const doc = new Doc(s);
    doc.insertNode(
      'L',
      { block: 'list', list: 'bullet', items: [] },
      { after: ids[0]! }
    );
    doc.appendListItem('L~li-0', 'L');
    doc.setText('L~li-0', 'bullet item');
    doc.insertListItemAfter('nested', 'L~li-0', 'numbered item', 'number');
    const xml = serializeWithXml(s);
    // The numbered item lives in an <ol> wrapped inside the bullet <ul>.
    expect(xml).toMatch(
      /<ul[\s\S]*<ol[\s\S]*numbered item[\s\S]*<\/ol>[\s\S]*<\/ul>/
    );
  });

  it('removeListItem drops a single item, keeping the rest', () => {
    const { s, ids } = setup('intro');
    const doc = new Doc(s);
    doc.insertNode(
      'L',
      { block: 'list', list: 'bullet', items: [] },
      { after: ids[0]! }
    );
    doc.appendListItem('L~li-0', 'L');
    doc.setText('L~li-0', 'keep');
    doc.insertListItemAfter('drop', 'L~li-0', 'drop', 'bullet');
    doc.removeListItem('drop');
    const out = plain(s);
    expect(out).toContain('keep');
    expect(out).not.toContain('drop');
  });

  it('removeListItem rejects a non-list-item target', () => {
    const { s, ids } = setup('para');
    expect(() => new Doc(s).removeListItem(ids[0]!)).toThrow(/not a list item/);
  });

  it('insertNode then a table cell edit', () => {
    const { s, ids } = setup('intro');
    const doc = new Doc(s);
    doc.insertNode(
      't',
      {
        block: 'table',
        rows: [
          ['A', 'B'],
          ['c', 'd'],
        ],
      },
      { after: ids[0]! }
    );
    doc.setCell('t', 1, 0, 'C');
    expect(plain(s)).toContain('C');
  });
});

describe('Doc — readers', () => {
  it('textLength counts plain-text length', () => {
    const { s, ids } = setup('hello');
    expect(new Doc(s).textLength(ids[0]!)).toBe(5);
  });

  it('locate returns each occurrence with text-node id + offsets', () => {
    const { s, ids } = setup('frog and frog');
    const matches = new Doc(s).locate(ids[0]!, 'frog', { all: true });
    expect(matches).toHaveLength(2);
    expect(matches[0]).toMatchObject({ start: 0, end: 4 });
    expect(matches[1]).toMatchObject({ start: 9, end: 13 });
  });

  it('locate honors nth scope', () => {
    const { s, ids } = setup('a a a');
    expect(new Doc(s).locate(ids[0]!, 'a', { nth: 2 })).toHaveLength(1);
  });

  it('cellNode resolves a cell content id whose text we can measure', () => {
    const { s, ids } = setup('x');
    const doc = new Doc(s);
    doc.insertNode(
      't',
      { block: 'table', rows: [['Head'], ['body']] },
      { after: ids[0]! }
    );
    const cell = doc.cellNode('t', 1, 0);
    expect(doc.textLength(cell)).toBe(4); // 'body'
  });
});

describe('Doc — error surfacing', () => {
  it('an unknown id throws EditError (so the tool can report it)', () => {
    const { s } = setup('hi');
    expect(() => new Doc(s).setText('nope', 'x')).toThrow(
      /No node with id|nope/
    );
  });

  it('a failed edit leaves the document untouched', () => {
    const { s, ids } = setup('safe');
    const doc = new Doc(s);
    expect(() => doc.removeNode('ghost')).toThrow();
    expect(plain(s)).toBe(`safe {${ids[0]}|paragraph}`); // unchanged
  });
});

describe('applyEdit routing', () => {
  it('routes a structured Edit to the right DocWriter method', () => {
    const { s, ids } = setup('routed');
    applyEdit(new Doc(s), {
      fn: 'setBlockType',
      node: ids[0]!,
      block: 'quote',
    });
    expect(plain(s)).toBe(`> routed {${ids[0]}|quote}`);
  });
});

/** Durable ids of a top-level block's element children (e.g. list items). */
function childIds(s: Session, topLevelIndex = 0): string[] {
  return read(s, () => {
    const block = $getRoot().getChildren()[topLevelIndex] as ElementNode;
    return block.getChildren().map((c) => $getId(c) ?? '?');
  });
}

// ── locate ───────────────────────────────────────────────────────────────────

describe('Doc.locate — within and across text nodes', () => {
  it('multiple occurrences within ONE plain text node, within-node offsets', () => {
    const { s, ids } = setup('a a a');
    const matches = new Doc(s).locate(ids[0]!, 'a', { all: true });
    expect(matches).toHaveLength(3);
    expect(matches.map((m) => [m.start, m.end])).toEqual([
      [0, 1],
      [2, 3],
      [4, 5],
    ]);
    // all the same text node
    expect(new Set(matches.map((m) => m.node)).size).toBe(1);
  });

  it('occurrences ACROSS two text runs report per-node (within-node) offsets', () => {
    // 'a **b** a' → runs: "a " (plain), "b" (bold), " a" (plain).
    const { s, ids } = setup('a **b** a');
    const matches = new Doc(s).locate(ids[0]!, 'a', { all: true });
    expect(matches).toHaveLength(2);
    // first run "a ": match at 0..1 ; third run " a": match at 1..2 (within that node)
    expect(matches[0]).toMatchObject({ start: 0, end: 1 });
    expect(matches[1]).toMatchObject({ start: 1, end: 2 });
    // the two matches live in DIFFERENT text nodes
    expect(matches[0]!.node).not.toBe(matches[1]!.node);
  });

  it('node id is the text-node id (not the block id)', () => {
    const { s, ids } = setup('hello');
    const matches = new Doc(s).locate(ids[0]!, 'ell');
    expect(matches).toHaveLength(1);
    expect(matches[0]!.node).not.toBe(ids[0]); // distinct from the block id
    expect(matches[0]).toMatchObject({ start: 1, end: 4 });
  });

  it('default scope {} returns only the FIRST occurrence', () => {
    const { s, ids } = setup('a a a');
    expect(new Doc(s).locate(ids[0]!, 'a', {})).toHaveLength(1);
    expect(new Doc(s).locate(ids[0]!, 'a', {})[0]).toMatchObject({
      start: 0,
      end: 1,
    });
  });

  it('scope { nth: 2 } returns only the 2nd', () => {
    const { s, ids } = setup('a a a');
    const m = new Doc(s).locate(ids[0]!, 'a', { nth: 2 });
    expect(m).toHaveLength(1);
    expect(m[0]).toMatchObject({ start: 2, end: 3 });
  });

  it('scope { nth } counts across text-node boundaries', () => {
    const { s, ids } = setup('a **b** a'); // 'a' occurs in run 1 (occ 1) and run 3 (occ 2)
    const m = new Doc(s).locate(ids[0]!, 'a', { nth: 2 });
    expect(m).toHaveLength(1);
    expect(m[0]).toMatchObject({ start: 1, end: 2 }); // within the third run " a"
  });

  it('zero matches → []', () => {
    const { s, ids } = setup('hello');
    expect(new Doc(s).locate(ids[0]!, 'zzz', { all: true })).toEqual([]);
  });

  it('overlapping search advances past each whole match (non-overlapping)', () => {
    const { s, ids } = setup('aaaa');
    // 'aa' occurs at 0 and 2 (non-overlapping), not at 1.
    const m = new Doc(s).locate(ids[0]!, 'aa', { all: true });
    expect(m.map((x) => x.start)).toEqual([0, 2]);
  });
});

// ── insertText ─────────────────────────────────────────────────────────────

describe('Doc.insertText — multi-run formatting preservation', () => {
  it('inserting inside the second (plain) run keeps the first run bold', () => {
    const { s, ids } = setup('**bold** plain');
    new Doc(s).insertText(ids[0]!, 6, 'Z'); // offset 6 is inside " plain"
    expect(plain(s)).toBe(`**bold** pZlain {${ids[0]}|paragraph}`);
  });

  it('inserting inside the bold run (offset 3) keeps it bold', () => {
    const { s, ids } = setup('a **b** c');
    // runs: "a "(0-1 plain), "b"(2 bold), " c"(3-4 plain). offset 3 = inside the bold "b".
    new Doc(s).insertText(ids[0]!, 3, 'X');
    expect(plain(s)).toBe(`a **bX** c {${ids[0]}|paragraph}`);
  });

  it('inserting at a run boundary (offset 2) lands in the earlier plain run', () => {
    const { s, ids } = setup('a **b** c');
    // offset 2 is the end of the "a " run (length 2) → text goes there, stays plain.
    new Doc(s).insertText(ids[0]!, 2, 'X');
    expect(plain(s)).toBe(`a X**b** c {${ids[0]}|paragraph}`);
  });

  it('inserting past the end appends to the last run', () => {
    const { s, ids } = setup('hi');
    new Doc(s).insertText(ids[0]!, 99, '!');
    expect(plain(s)).toBe(`hi! {${ids[0]}|paragraph}`);
  });

  it('inserting into an emptied block creates a fresh text node', () => {
    const { s, ids } = setup('x');
    const doc = new Doc(s);
    doc.removeText(ids[0]!, 0, 1); // now empty
    doc.insertText(ids[0]!, 0, 'new');
    expect(plain(s)).toBe(`new {${ids[0]}|paragraph}`);
  });
});

// ── removeText ───────────────────────────────────────────────────────────────

describe('Doc.removeText — slices and spans', () => {
  it('removes a range spanning two text nodes', () => {
    const { s, ids } = setup('a **b** c'); // ' b ' spans plain/bold/plain
    new Doc(s).removeText(ids[0]!, 1, 3); // removes offsets 1,2,3 → " b " → "ac"
    expect(plain(s)).toBe(`ac {${ids[0]}|paragraph}`);
  });

  it('removes everything', () => {
    const { s, ids } = setup('hello');
    new Doc(s).removeText(ids[0]!, 0, 5);
    expect(plain(s)).toBe(` {${ids[0]}|paragraph}`);
  });

  it('removes a middle slice', () => {
    const { s, ids } = setup('abcdef');
    new Doc(s).removeText(ids[0]!, 2, 2); // remove "cd"
    expect(plain(s)).toBe(`abef {${ids[0]}|paragraph}`);
  });

  it('len running past the end stops at the content edge', () => {
    const { s, ids } = setup('abc');
    new Doc(s).removeText(ids[0]!, 1, 100);
    expect(plain(s)).toBe(`a {${ids[0]}|paragraph}`);
  });
});

// ── insertInline ─────────────────────────────────────────────────────────────

describe('Doc.insertInline — offset placement', () => {
  it('offset 0 inserts before the first run', () => {
    const { s, ids } = setup('hello');
    new Doc(s).insertInline('r', ids[0]!, 0, {
      inline: 'date',
      date: '2026-01-01',
    });
    const out = plain(s);
    expect(out.startsWith('2026-01-01 {')).toBe(true);
    expect(out).toContain('|date-mention}hello ');
    expect(out).toContain(`{${ids[0]}|paragraph}`);
  });

  it('a middle offset splits the run (linebreak shows up between the halves)', () => {
    const { s, ids } = setup('hello');
    new Doc(s).insertInline('r', ids[0]!, 2, { inline: 'linebreak' });
    // linebreak becomes a real newline between "he" and "llo"
    expect(plain(s)).toBe(`he\nllo {${ids[0]}|paragraph}`);
  });

  it('offset at the end appends after the last run', () => {
    const { s, ids } = setup('hello');
    new Doc(s).insertInline('r', ids[0]!, 5, {
      inline: 'date',
      date: '2026-01-01',
    });
    const out = plain(s);
    expect(out.startsWith('hello2026-01-01 {')).toBe(true);
    expect(out).toContain('|date-mention}');
    expect(out).toContain(`{${ids[0]}|paragraph}`);
  });

  it('offset past the end also appends', () => {
    const { s, ids } = setup('hello');
    new Doc(s).insertInline('r', ids[0]!, 99, {
      inline: 'date',
      date: '2026-01-01',
    });
    expect(plain(s)).toContain('hello2026-01-01');
  });
});

// ── id preservation ──────────────────────────────────────────────────────────

describe('Doc — block-type swaps preserve the durable id', () => {
  it('paragraph → heading → quote → paragraph keeps the same id, resolvable each step', () => {
    const { s, ids } = setup('Title');
    const id = ids[0]!;
    const doc = new Doc(s);
    doc.setBlockType(id, 'heading', { level: 2 });
    expect(plain(s)).toBe(`## Title {${id}|heading}`);
    doc.setBlockType(id, 'quote', {});
    expect(plain(s)).toBe(`> Title {${id}|quote}`);
    doc.setBlockType(id, 'paragraph', {});
    expect(plain(s)).toBe(`Title {${id}|paragraph}`);
    // a follow-up content edit still resolves the same id
    doc.appendText(id, '!');
    expect(plain(s)).toBe(`Title! {${id}|paragraph}`);
  });
});

describe('Doc.setListType — preserves item ids', () => {
  it('toggling a paragraph into a bullet list produces a list with an addressable item', () => {
    const { s, ids } = setup('one');
    const doc = new Doc(s);
    doc.setListType([ids[0]!], 'bullet');
    expect(plain(s)).toContain('- one');
    // the resulting list item has its own id, which resolves for a follow-up edit
    const itemId = childIds(s)[0]!;
    doc.appendText(itemId, '!');
    expect(plain(s)).toContain('one!');
  });

  it('an existing bullet list switched to numbered keeps every item id', () => {
    const { s } = setup('- one\n- two');
    const before = childIds(s);
    new Doc(s).setListType([before[0]!], 'number');
    const after = childIds(s);
    expect(after).toEqual(before);
    expect(plain(s)).toContain('1. one');
    expect(plain(s)).toContain('2. two');
  });
});

// ── refs ─────────────────────────────────────────────────────────────────────

describe('Doc — ref resolution', () => {
  it('insertNode then setText/appendText/bold target the ref', () => {
    const { s, ids } = setup('first');
    const doc = new Doc(s);
    doc.insertNode(
      'ref-x',
      { block: 'paragraph', text: 'body' },
      { after: ids[0]! }
    );
    doc.appendText('ref-x', '!');
    doc.formatText('ref-x', 'body', 'bold', true, { all: true });
    const out = plain(s);
    expect(out).toContain('first');
    expect(out).toContain('**body**!');
  });

  it('inserting two blocks mints two distinct ids', () => {
    const { s, ids } = setup('first');
    const doc = new Doc(s);
    doc.insertNode('a', { block: 'paragraph', text: 'AA' }, { after: ids[0]! });
    doc.insertNode('b', { block: 'paragraph', text: 'BB' }, { after: ids[0]! });
    // resolve both refs by editing each — both should succeed and stay distinct
    doc.appendText('a', '1');
    doc.appendText('b', '2');
    const out = plain(s);
    expect(out).toContain('AA1');
    expect(out).toContain('BB2');
  });
});

// ── tables ─────────────────────────────────────────────────────────────────

describe('Doc — tables', () => {
  function makeTable(rows: string[][]) {
    const { s, ids } = setup('intro');
    const doc = new Doc(s);
    doc.insertNode('t', { block: 'table', rows }, { after: ids[0]! });
    return { s, doc };
  }

  it('setCell each cell of a 2x2 table', () => {
    const { s, doc } = makeTable([
      ['H1', 'H2'],
      ['a', 'b'],
    ]);
    doc.setCell('t', 0, 1, 'HX');
    doc.setCell('t', 1, 0, 'AA');
    doc.setCell('t', 1, 1, 'BB');
    const out = plain(s);
    expect(out).toContain('| H1 | HX |');
    expect(out).toContain('| AA | BB |');
  });

  it('cellNode resolves and textLength matches the cell content', () => {
    const { s, doc } = makeTable([['Head'], ['body']]);
    expect(doc.textLength(doc.cellNode('t', 0, 0))).toBe(4); // 'Head'
    expect(doc.textLength(doc.cellNode('t', 1, 0))).toBe(4); // 'body'
  });

  it('addRow appends a row with the right column count', () => {
    const { s, doc } = makeTable([
      ['H1', 'H2'],
      ['a', 'b'],
    ]);
    doc.addRow('t');
    const cols = rowCellCounts(s);
    expect(cols).toEqual([2, 2, 2]); // 3 rows, all 2 cols
  });

  it('addRow at an index inserts before that row', () => {
    const { s, doc } = makeTable([
      ['H1', 'H2'],
      ['a', 'b'],
    ]);
    doc.addRow('t', 1); // before the body row
    doc.setCell('t', 1, 0, 'mid');
    expect(plain(s)).toContain('| mid |');
    expect(rowCellCounts(s)).toEqual([2, 2, 2]);
  });

  it('addColumn gives every row a new cell; the header-row cell is a header', () => {
    const { s, doc } = makeTable([
      ['H1', 'H2'],
      ['a', 'b'],
    ]);
    doc.addColumn('t');
    expect(rowCellCounts(s)).toEqual([3, 3]);
    // header row's new cell is a header cell
    const headerStates = read(s, () => {
      const rows = tableRows(s);
      return rows[0]!
        .getChildren()
        .filter($isTableCellNode)
        .map((c) => c.getHeaderStyles());
    });
    expect(headerStates.at(-1)).not.toBe(0); // header bit set on the appended header cell
  });

  it('removeRow drops a row', () => {
    const { s, doc } = makeTable([
      ['H1', 'H2'],
      ['a', 'b'],
      ['c', 'd'],
    ]);
    doc.removeRow('t', 2); // drop the 'c d' row
    expect(rowCellCounts(s)).toHaveLength(2);
    expect(plain(s)).not.toContain('| c | d |');
  });

  it('removeColumn drops the column from every row', () => {
    const { s, doc } = makeTable([
      ['H1', 'H2', 'H3'],
      ['a', 'b', 'c'],
    ]);
    doc.removeColumn('t', 1); // drop the middle column
    expect(rowCellCounts(s)).toEqual([2, 2]);
    const out = plain(s);
    expect(out).toContain('| H1 | H3 |');
    expect(out).toContain('| a | c |');
  });
});

function tableRows(s: Session) {
  return read(s, () => {
    let table: LexicalNode | undefined;
    const walk = (n: LexicalNode) => {
      if (n.getType() === 'table') table = n;
      if ($isElementNode(n)) for (const c of n.getChildren()) walk(c);
    };
    for (const c of $getRoot().getChildren()) walk(c);
    return (table as ElementNode).getChildren().filter($isTableRowNode);
  });
}
function rowCellCounts(s: Session): number[] {
  return read(s, () => {
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

// ── buildNode ────────────────────────────────────────────────────────────────

describe('buildNode — each spec builds the right node type', () => {
  const elementBlocks: Array<[string, any, string]> = [
    ['paragraph', { block: 'paragraph', text: 'p' }, 'paragraph'],
    ['heading', { block: 'heading', level: 3, text: 'h' }, 'heading'],
    ['quote', { block: 'quote', text: 'q' }, 'quote'],
    ['code', { block: 'code', language: 'ts', text: 'c' }, 'custom-code'],
    ['list', { block: 'list', list: 'bullet', items: ['x'] }, 'list'],
    ['table', { block: 'table', rows: [['A']] }, 'table'],
  ];
  it.each(
    elementBlocks
  )('%s builds an ElementNode of the right type', (_label, spec, type) => {
    const { s } = setup('x');
    edit(s, () => {
      const n = buildNode(spec);
      expect(n.getType()).toBe(type);
      expect($isElementNode(n)).toBe(true);
    });
  });

  const decoratorBlocks: Array<[string, any, string]> = [
    ['divider', { block: 'divider' }, 'horizontalrule'],
    [
      'image',
      { block: 'image', srcType: 'url', url: 'http://i', alt: 'a' },
      'image',
    ],
    ['video', { block: 'video', srcType: 'url', url: 'http://v' }, 'video'],
    ['equation block', { block: 'equation', tex: 'x^2' }, 'equation'],
    ['linebreak inline', { inline: 'linebreak' }, 'linebreak'],
    ['equation inline', { inline: 'equation', tex: 'y' }, 'equation'],
    ['date inline', { inline: 'date', date: '2026-01-01' }, 'date-mention'],
  ];
  it.each(
    decoratorBlocks
  )('%s builds the right node type (non-element)', (_label, spec, type) => {
    const { s } = setup('x');
    edit(s, () => {
      const n = buildNode(spec);
      expect(n.getType()).toBe(type);
    });
  });

  it('mention spec builds the right node types', () => {
    const { s } = setup('x');
    edit(s, () => {
      expect(
        buildNode({
          inline: 'mention',
          mention: { kind: 'group', groupAlias: 'g' },
        }).getType()
      ).toBe('group-mention');
      expect(
        buildNode({
          inline: 'mention',
          mention: { kind: 'user', userId: 'u1', email: 'a@b.com' },
        }).getType()
      ).toBe('user-mention');
    });
  });
});

describe('buildNode — list spec serializes plausibly when placed', () => {
  it('inserting a bullet list block serializes its items', () => {
    const { s, ids } = setup('intro');
    new Doc(s).insertNode(
      'l',
      { block: 'list', list: 'bullet', items: ['one', 'two'] },
      { after: ids[0]! }
    );
    const out = plain(s);
    expect(out).toContain('- one');
    expect(out).toContain('- two');
  });

  it('inserting a code block serializes its language fence and text', () => {
    const { s, ids } = setup('intro');
    new Doc(s).insertNode(
      'c',
      { block: 'code', language: 'ts', text: 'const a=1' },
      { after: ids[0]! }
    );
    expect(plain(s)).toContain('const a=1');
  });

  it('inserting an inline equation via insertInline serializes as $tex$', () => {
    const { s, ids } = setup('hello world');
    new Doc(s).insertInline('e', ids[0]!, 5, { inline: 'equation', tex: 'y' });
    expect(plain(s)).toContain('$y$');
  });
});

// ── block-level decorator inserts (divider/image/video/equation) ──────────────

describe('Doc.insertNode — block decorator specs', () => {
  // divider/image/video/equation build DecoratorNodes (not ElementNodes); these
  // are still valid top-level blocks and must insert (insertNode rejects only
  // genuinely inline specs).
  const rootCount = (s: ReturnType<typeof setup>['s']) =>
    s.editor.getEditorState().read(() => $getRoot().getChildren().length);

  it('inserts a divider after a block', () => {
    const { s, ids } = setup('x');
    const before = rootCount(s);
    expect(() =>
      new Doc(s).insertNode('d', { block: 'divider' }, { after: ids[0]! })
    ).not.toThrow();
    expect(rootCount(s)).toBe(before + 1);
  });
  it('inserts a block image after a block', () => {
    const { s, ids } = setup('x');
    const before = rootCount(s);
    expect(() =>
      new Doc(s).insertNode(
        'i',
        { block: 'image', srcType: 'url', url: 'http://i', alt: 'a' },
        { after: ids[0]! }
      )
    ).not.toThrow();
    expect(rootCount(s)).toBe(before + 1);
  });
  it('inserts a block equation after a block', () => {
    const { s, ids } = setup('x');
    const before = rootCount(s);
    expect(() =>
      new Doc(s).insertNode(
        'e',
        { block: 'equation', tex: 'x^2' },
        { after: ids[0]! }
      )
    ).not.toThrow();
    expect(rootCount(s)).toBe(before + 1);
  });
  it('still rejects a genuinely inline spec', () => {
    const { s, ids } = setup('x');
    expect(() =>
      new Doc(s).insertNode('lb', { inline: 'linebreak' }, { after: ids[0]! })
    ).toThrow(/block spec/);
  });
});

// ── error surfacing ───────────────────────────────────────────────────────────

describe('Doc — error surfacing & atomicity', () => {
  it('a failed insert (unknown anchor) leaves the doc untouched', () => {
    const { s, ids } = setup('safe');
    const doc = new Doc(s);
    expect(() =>
      doc.insertNode('r', { block: 'paragraph', text: 'x' }, { after: 'ghost' })
    ).toThrow();
    expect(plain(s)).toBe(`safe {${ids[0]}|paragraph}`);
  });

  it('cellNode on a missing cell throws EditError', () => {
    const { s, ids } = setup('intro');
    const doc = new Doc(s);
    doc.insertNode('t', { block: 'table', rows: [['A']] }, { after: ids[0]! });
    expect(() => doc.cellNode('t', 9, 9)).toThrow();
  });

  it('a failed setCell leaves the table untouched', () => {
    const { s, ids } = setup('intro');
    const doc = new Doc(s);
    doc.insertNode(
      't',
      {
        block: 'table',
        rows: [
          ['A', 'B'],
          ['c', 'd'],
        ],
      },
      { after: ids[0]! }
    );
    const before = plain(s);
    expect(() => doc.setCell('t', 9, 9, 'x')).toThrow();
    expect(plain(s)).toBe(before);
  });
});
