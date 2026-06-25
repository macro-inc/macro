import { $isLinkNode } from '@lexical/link';
import { $isMarkNode } from '@lexical/mark';
import { $isTableCellNode, $isTableRowNode } from '@lexical/table';
import {
  $getRoot,
  $isElementNode,
  $isTextNode,
  type ElementNode,
  type LexicalNode,
} from 'lexical';
import { describe, expect, it } from 'vitest';
import { $getId } from '../../../../lexical-core/plugins/nodeIdPlugin';
import { edit, read, setup } from '../ai-toolkit/_test-helpers';
import type { Session } from '../ai-toolkit/session';
import { serializeWithXml } from '../utils';
import { buildNode, Doc } from './doc';

/** Get text nodes in a block with their format. */
function textRuns(session: Session, blockIdx = 0) {
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

describe('Doc — text content writes', () => {
  it('insertText splices in place, preserving the block id', () => {
    const { session, ids } = setup('hello world');
    new Doc(session).apply({
      kind: 'insertText',
      node: ids[0]!,
      at: 5,
      text: ' there',
    });
    expect(serializeWithXml(session)).toContain('hello there world');
    expect(serializeWithXml(session)).toContain(`id="${ids[0]}"`);
  });

  it('removeText deletes a range', () => {
    const { session, ids } = setup('hello world');
    new Doc(session).apply({
      kind: 'removeText',
      node: ids[0]!,
      at: 5,
      len: 6,
    }); // remove " world"
    expect(textRuns(session)[0]?.text).toBe('hello'); // exact, not just "contains"
    expect(serializeWithXml(session)).toContain(`id="${ids[0]}"`);
  });

  it('setText replaces content and strips formatting', () => {
    const { session, ids } = setup('the **bold** thing');
    new Doc(session).apply({
      kind: 'setText',
      node: ids[0]!,
      text: 'plain now',
    });
    expect(serializeWithXml(session)).toContain('plain now');
    expect(serializeWithXml(session)).toContain(`id="${ids[0]}"`);
  });

  it('insertText at the end of a formatted run stays plain (no format inheritance)', () => {
    const { session, ids } = setup('a **b**'); // ends in a bold run
    const len = new Doc(session).textLength(ids[0]!);
    new Doc(session).apply({
      kind: 'insertText',
      node: ids[0]!,
      at: len,
      text: ' c',
    });
    // 'b' is bold, ' c' appended after is NOT bold
    const runs = textRuns(session);
    const boldB = runs.find((r) => r.text === 'b');
    const plainC = runs.find((r) => r.text.includes('c'));
    expect(boldB?.bold).toBe(true);
    expect(plainC?.bold).toBe(false);
  });

  it('insertText at offset 0 before a formatted run stays plain', () => {
    const { session, ids } = setup('**b** c'); // starts with a bold run
    new Doc(session).apply({
      kind: 'insertText',
      node: ids[0]!,
      at: 0,
      text: 'a ',
    });
    // 'a ' inserted at front is NOT bold
    const runs = textRuns(session);
    const prefixRun = runs.find((r) => r.text.includes('a'));
    expect(prefixRun?.bold).toBe(false);
  });

  it('typing char-by-char into an emptied block builds the text', () => {
    const { session, ids } = setup('x');
    const doc = new Doc(session);
    doc.apply({ kind: 'removeText', node: ids[0]!, at: 0, len: 1 });
    for (const [i, ch] of [...'Hi'].entries())
      doc.apply({ kind: 'insertText', node: ids[0]!, at: i, text: ch });
    expect(serializeWithXml(session)).toContain('Hi');
    expect(serializeWithXml(session)).toContain(`id="${ids[0]}"`);
  });
});

describe('Doc — inline formatting (reuses ai-toolkit)', () => {
  it('formatText bolds every occurrence', () => {
    const { session, ids } = setup('the Bluejay and the Bluejay');
    new Doc(session).apply({
      kind: 'formatText',
      node: ids[0]!,
      match: 'Bluejay',
      format: 'bold',
      on: true,
      scope: { kind: 'all' },
    });
    const runs = textRuns(session);
    const boldRuns = runs.filter((r) => r.text === 'Bluejay');
    expect(boldRuns).toHaveLength(2);
    expect(boldRuns.every((r) => r.bold)).toBe(true);
  });

  it('formatText off clears that format on a match', () => {
    const { session, ids } = setup('the **Bluejay** launch');
    new Doc(session).apply({
      kind: 'formatText',
      node: ids[0]!,
      match: 'Bluejay',
      format: 'bold',
      on: false,
      scope: { kind: 'all' },
    });
    const runs = textRuns(session);
    const bluejayRun = runs.find((r) => r.text === 'Bluejay');
    expect(bluejayRun?.bold).toBe(false);
  });

  it('markText on highlights (wraps in a mark node); off is a no-op when not highlighted', () => {
    const { session, ids } = setup('warn here');
    expect(() =>
      new Doc(session).apply({
        kind: 'markText',
        node: ids[0]!,
        match: 'warn',
        on: false,
        scope: { kind: 'all' },
      })
    ).not.toThrow();
    new Doc(session).apply({
      kind: 'markText',
      node: ids[0]!,
      match: 'warn',
      on: true,
      scope: { kind: 'all' },
    });
    const hasMark = read(session, () => {
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
    const { session, ids } = setup('see docs');
    expect(() =>
      new Doc(session).apply({
        kind: 'linkText',
        node: ids[0]!,
        match: 'docs',
        url: null,
        scope: { kind: 'all' },
      })
    ).not.toThrow();
    new Doc(session).apply({
      kind: 'linkText',
      node: ids[0]!,
      match: 'docs',
      url: 'http://x',
      scope: { kind: 'all' },
    });
    // verify link node in tree
    const linkUrl = read(session, () => {
      const block = $getRoot().getFirstChild() as ElementNode;
      for (const c of block.getChildren()) {
        if ($isLinkNode(c)) return c.getURL();
      }
      return null;
    });
    expect(linkUrl).toBe('http://x');
  });
});

describe('Doc — block type & lists (id preservation)', () => {
  it('setBlockType heading mints a fresh durable id (old id leaves the doc)', () => {
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
    expect(xml).toContain('Title');
    expect(xml).not.toContain(`id="${before}"`); // fresh id, so Loro sees delete+insert
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
    doc.apply({ kind: 'appendText', node: ids[0]!, text: '!' }); // old id forwards to the new heading
    expect(serializeWithXml(session)).toContain('<h2');
    expect(serializeWithXml(session)).toContain('Title!');
  });

  it('setChecked operates on a list item (addressed by its own id)', () => {
    const { session } = setup('- [ ] todo');
    // top-level id is the list; the AI addresses the *item* by its id.
    const itemId = read(session, () =>
      $getId(
        (
          $getRoot().getFirstChild() as ElementNode
        ).getFirstChild() as LexicalNode
      )
    );
    new Doc(session).apply({
      kind: 'setChecked',
      node: itemId!,
      checked: true,
    });
    expect(serializeWithXml(session)).toContain('checked="true"');
  });
});

describe('Doc — structure & refs', () => {
  it('insertNode mints an id resolvable by a follow-up edit via its ref', () => {
    const { session, ids } = setup('first');
    const doc = new Doc(session);
    doc.apply({
      kind: 'insertNode',
      ref: 'ref-1',
      spec: { block: 'paragraph', text: 'second' },
      at: { after: ids[0]! },
    });
    doc.apply({ kind: 'setText', node: 'ref-1', text: 'SECOND' });
    const out = serializeWithXml(session);
    expect(out).toContain('first');
    expect(out).toContain('SECOND');
  });

  it('inserts a block anchored to a divider (hr), landing as its sibling', () => {
    // A divider is a decorator block, not an ElementNode. Anchoring an insert to
    // it must still work
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
    expect(out).toContain('<hr');
    expect(out).toContain('<h2');
    expect(out).toContain('Section');
    // the heading landed as the divider's following sibling, not at the root edge
    expect(out.indexOf('<hr')).toBeLessThan(out.indexOf('<h2'));
  });

  it('removeNode deletes a block', () => {
    const { session, ids } = setup('keep\n\ndrop');
    new Doc(session).apply({ kind: 'removeNode', node: ids[1]! });
    expect(serializeWithXml(session)).toContain('keep');
    expect(serializeWithXml(session)).not.toContain('drop');
    expect(serializeWithXml(session)).toContain(`id="${ids[0]}"`);
  });

  it('appendListItem grows an empty list, each item typed via its ref', () => {
    // Mirrors how the animator builds a list: insert empty, then append + type.
    const { session, ids } = setup('intro');
    const doc = new Doc(session);
    doc.apply({
      kind: 'insertNode',
      ref: 'L',
      spec: { block: 'list', list: 'bullet', items: [] },
      at: { after: ids[0]! },
    });
    doc.apply({ kind: 'appendListItem', ref: 'L~li-0', node: 'L' });
    doc.apply({ kind: 'setText', node: 'L~li-0', text: 'first' });
    doc.apply({ kind: 'appendListItem', ref: 'L~li-1', node: 'L' });
    doc.apply({ kind: 'setText', node: 'L~li-1', text: 'second' });
    const out = serializeWithXml(session);
    expect(out).toContain('first');
    expect(out).toContain('second');
  });

  it('appendListItem rejects a non-list target', () => {
    const { session, ids } = setup('para');
    expect(() =>
      new Doc(session).apply({
        kind: 'appendListItem',
        ref: 'x',
        node: ids[0]!,
      })
    ).toThrow(/not a list/);
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
    doc.apply({ kind: 'appendListItem', ref: 'L~li-0', node: 'L' });
    doc.apply({ kind: 'setText', node: 'L~li-0', text: 'middle' });
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
    // One list, three plain items in order, no nesting.
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
    doc.apply({ kind: 'appendListItem', ref: 'L~li-0', node: 'L' });
    doc.apply({ kind: 'setText', node: 'L~li-0', text: 'bullet item' });
    doc.apply({
      kind: 'insertListItemAfter',
      ref: 'nested',
      node: 'L~li-0',
      text: 'numbered item',
      list: 'number',
    });
    const xml = serializeWithXml(session);
    // The numbered item lives in an <ol> wrapped inside the bullet <ul>.
    expect(xml).toMatch(
      /<ul[\s\S]*<ol[\s\S]*numbered item[\s\S]*<\/ol>[\s\S]*<\/ul>/
    );
  });

  it('removeListItem drops a single item, keeping the rest', () => {
    const { session, ids } = setup('intro');
    const doc = new Doc(session);
    doc.apply({
      kind: 'insertNode',
      ref: 'L',
      spec: { block: 'list', list: 'bullet', items: [] },
      at: { after: ids[0]! },
    });
    doc.apply({ kind: 'appendListItem', ref: 'L~li-0', node: 'L' });
    doc.apply({ kind: 'setText', node: 'L~li-0', text: 'keep' });
    doc.apply({
      kind: 'insertListItemAfter',
      ref: 'drop',
      node: 'L~li-0',
      text: 'drop',
      list: 'bullet',
    });
    doc.apply({ kind: 'removeListItem', node: 'drop' });
    const out = serializeWithXml(session);
    expect(out).toContain('keep');
    expect(out).not.toContain('drop');
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
  it('textLength counts plain-text length', () => {
    const { session, ids } = setup('hello');
    expect(new Doc(session).textLength(ids[0]!)).toBe(5);
  });

  it('locate returns each occurrence with text-node id + offsets', () => {
    const { session, ids } = setup('frog and frog');
    const matches = new Doc(session).locate(ids[0]!, 'frog', { kind: 'all' });
    expect(matches).toHaveLength(2);
    expect(matches[0]).toMatchObject({ start: 0, end: 4 });
    expect(matches[1]).toMatchObject({ start: 9, end: 13 });
  });

  it('locate honors nth scope', () => {
    const { session, ids } = setup('a a a');
    expect(
      new Doc(session).locate(ids[0]!, 'a', { kind: 'nth', n: 2 })
    ).toHaveLength(1);
  });

  it('cellNode resolves a cell content id whose text we can measure', () => {
    const { session, ids } = setup('x');
    const doc = new Doc(session);
    doc.apply({
      kind: 'insertNode',
      ref: 't',
      spec: { block: 'table', rows: [['Head'], ['body']] },
      at: { after: ids[0]! },
    });
    const cell = doc.cellNode('t', 1, 0);
    expect(doc.textLength(cell)).toBe(4); // 'body'
  });
});

describe('Doc — error surfacing', () => {
  it('an unknown id throws EditError (so the tool can report it)', () => {
    const { session } = setup('hi');
    expect(() =>
      new Doc(session).apply({ kind: 'setText', node: 'nope', text: 'x' })
    ).toThrow(/No node with id|nope/);
  });

  it('a failed edit leaves the document untouched', () => {
    const { session, ids } = setup('safe');
    const doc = new Doc(session);
    expect(() => doc.apply({ kind: 'removeNode', node: 'ghost' })).toThrow();
    expect(serializeWithXml(session)).toContain('safe'); // unchanged
    expect(serializeWithXml(session)).toContain(`id="${ids[0]}"`);
  });
});

/** Durable ids of a top-level block's element children (e.g. list items). */
function childIds(session: Session, topLevelIndex = 0): string[] {
  return read(session, () => {
    const block = $getRoot().getChildren()[topLevelIndex] as ElementNode;
    return block.getChildren().map((c) => $getId(c) ?? '?');
  });
}

// ── locate ───────────────────────────────────────────────────────────────────

describe('Doc.locate — within and across text nodes', () => {
  it('multiple occurrences within ONE plain text node, within-node offsets', () => {
    const { session, ids } = setup('a a a');
    const matches = new Doc(session).locate(ids[0]!, 'a', { kind: 'all' });
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
    const { session, ids } = setup('a **b** a');
    const matches = new Doc(session).locate(ids[0]!, 'a', { kind: 'all' });
    expect(matches).toHaveLength(2);
    // first run "a ": match at 0..1 ; third run " a": match at 1..2 (within that node)
    expect(matches[0]).toMatchObject({ start: 0, end: 1 });
    expect(matches[1]).toMatchObject({ start: 1, end: 2 });
    // the two matches live in DIFFERENT text nodes
    expect(matches[0]!.node).not.toBe(matches[1]!.node);
  });

  it('node id is the text-node id (not the block id)', () => {
    const { session, ids } = setup('hello');
    const matches = new Doc(session).locate(ids[0]!, 'ell');
    expect(matches).toHaveLength(1);
    expect(matches[0]!.node).not.toBe(ids[0]); // distinct from the block id
    expect(matches[0]).toMatchObject({ start: 1, end: 4 });
  });

  it('default scope (undefined) returns only the FIRST occurrence', () => {
    const { session, ids } = setup('a a a');
    expect(new Doc(session).locate(ids[0]!, 'a')).toHaveLength(1);
    expect(new Doc(session).locate(ids[0]!, 'a')[0]).toMatchObject({
      start: 0,
      end: 1,
    });
  });

  it("scope { kind: 'nth', n: 2 } returns only the 2nd", () => {
    const { session, ids } = setup('a a a');
    const m = new Doc(session).locate(ids[0]!, 'a', { kind: 'nth', n: 2 });
    expect(m).toHaveLength(1);
    expect(m[0]).toMatchObject({ start: 2, end: 3 });
  });

  it('scope { nth } counts across text-node boundaries', () => {
    const { session, ids } = setup('a **b** a'); // 'a' occurs in run 1 (occ 1) and run 3 (occ 2)
    const m = new Doc(session).locate(ids[0]!, 'a', { kind: 'nth', n: 2 });
    expect(m).toHaveLength(1);
    expect(m[0]).toMatchObject({ start: 1, end: 2 }); // within the third run " a"
  });

  it('zero matches → []', () => {
    const { session, ids } = setup('hello');
    expect(new Doc(session).locate(ids[0]!, 'zzz', { kind: 'all' })).toEqual(
      []
    );
  });

  it('overlapping search advances past each whole match (non-overlapping)', () => {
    const { session, ids } = setup('aaaa');
    // 'aa' occurs at 0 and 2 (non-overlapping), not at 1.
    const m = new Doc(session).locate(ids[0]!, 'aa', { kind: 'all' });
    expect(m.map((x) => x.start)).toEqual([0, 2]);
  });
});

// ── insertText ─────────────────────────────────────────────────────────────

describe('Doc.insertText — multi-run formatting preservation', () => {
  it('inserting inside the second (plain) run keeps the first run bold', () => {
    const { session, ids } = setup('**bold** plain');
    new Doc(session).apply({
      kind: 'insertText',
      node: ids[0]!,
      at: 6,
      text: 'Z',
    }); // offset 6 is inside " plain"
    // 'bold' run stays bold, inserted 'Z' is in plain area
    const runs = textRuns(session);
    const boldRun = runs.find((r) => r.text === 'bold');
    expect(boldRun?.bold).toBe(true);
    expect(serializeWithXml(session)).toContain('pZlain');
  });

  it('inserting inside the bold run (offset 3) keeps it bold', () => {
    const { session, ids } = setup('a **b** c');
    // runs: "a "(0-1 plain), "b"(2 bold), " c"(3-4 plain). offset 3 = inside the bold "b".
    new Doc(session).apply({
      kind: 'insertText',
      node: ids[0]!,
      at: 3,
      text: 'X',
    });
    const runs = textRuns(session);
    const boldRun = runs.find((r) => r.text === 'bX');
    expect(boldRun?.bold).toBe(true);
  });

  it('inserting at a run boundary (offset 2) lands in the earlier plain run', () => {
    const { session, ids } = setup('a **b** c');
    // offset 2 is the end of the "a " run (length 2) → text goes there, stays plain.
    new Doc(session).apply({
      kind: 'insertText',
      node: ids[0]!,
      at: 2,
      text: 'X',
    });
    // 'b' is still bold, 'X' is in the plain "a " run
    const runs = textRuns(session);
    const boldRun = runs.find((r) => r.text === 'b');
    expect(boldRun?.bold).toBe(true);
    expect(serializeWithXml(session)).toContain('X');
  });

  it('inserting past the end appends to the last run', () => {
    const { session, ids } = setup('hi');
    new Doc(session).apply({
      kind: 'insertText',
      node: ids[0]!,
      at: 99,
      text: '!',
    });
    expect(serializeWithXml(session)).toContain('hi!');
    expect(serializeWithXml(session)).toContain(`id="${ids[0]}"`);
  });

  it('inserting into an emptied block creates a fresh text node', () => {
    const { session, ids } = setup('x');
    const doc = new Doc(session);
    doc.apply({ kind: 'removeText', node: ids[0]!, at: 0, len: 1 }); // now empty
    doc.apply({ kind: 'insertText', node: ids[0]!, at: 0, text: 'new' });
    expect(serializeWithXml(session)).toContain('new');
    expect(serializeWithXml(session)).toContain(`id="${ids[0]}"`);
  });
});

// ── removeText ───────────────────────────────────────────────────────────────

describe('Doc.removeText — slices and spans', () => {
  it('removes a range spanning two text nodes', () => {
    const { session, ids } = setup('a **b** c'); // ' b ' spans plain/bold/plain
    new Doc(session).apply({
      kind: 'removeText',
      node: ids[0]!,
      at: 1,
      len: 3,
    }); // removes offsets 1,2,3 → " b " → "ac"
    // result is 'a' and 'c' as separate text nodes (no bold 'b')
    expect(serializeWithXml(session)).toContain('>a<');
    expect(serializeWithXml(session)).toContain('>c<');
    expect(serializeWithXml(session)).not.toContain('>b<');
    expect(serializeWithXml(session)).toContain(`id="${ids[0]}"`);
  });

  it('removes everything', () => {
    const { session, ids } = setup('hello');
    new Doc(session).apply({
      kind: 'removeText',
      node: ids[0]!,
      at: 0,
      len: 5,
    });
    // block still exists (just empty)
    expect(serializeWithXml(session)).toContain(`id="${ids[0]}"`);
    expect(serializeWithXml(session)).not.toContain('hello');
  });

  it('removes a middle slice', () => {
    const { session, ids } = setup('abcdef');
    new Doc(session).apply({
      kind: 'removeText',
      node: ids[0]!,
      at: 2,
      len: 2,
    }); // remove "cd"
    expect(serializeWithXml(session)).toContain('abef');
    expect(serializeWithXml(session)).toContain(`id="${ids[0]}"`);
  });

  it('len running past the end stops at the content edge', () => {
    const { session, ids } = setup('abc');
    new Doc(session).apply({
      kind: 'removeText',
      node: ids[0]!,
      at: 1,
      len: 100,
    });
    expect(serializeWithXml(session)).toContain('>a<');
    expect(serializeWithXml(session)).toContain(`id="${ids[0]}"`);
  });
});

// ── insertInline ─────────────────────────────────────────────────────────────

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
    expect(out).toContain('2026-01-01');
    expect(out).toContain('hello');
    expect(out).toContain(`id="${ids[0]}"`);
    // date comes before hello in the XML
    expect(out.indexOf('2026-01-01')).toBeLessThan(out.indexOf('hello'));
  });

  it('a middle offset splits the run (linebreak shows up between the halves)', () => {
    const { session, ids } = setup('hello');
    new Doc(session).apply({
      kind: 'insertInline',
      ref: 'r',
      node: ids[0]!,
      at: 2,
      spec: { inline: 'linebreak' },
    });
    // linebreak becomes a <br/> in XML
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
    expect(out).toContain('2026-01-01');
    expect(out).toContain('hello');
    // hello comes before date in the XML
    expect(out.indexOf('hello')).toBeLessThan(out.indexOf('2026-01-01'));
  });

  it('offset past the end also appends', () => {
    const { session, ids } = setup('hello');
    new Doc(session).apply({
      kind: 'insertInline',
      ref: 'r',
      node: ids[0]!,
      at: 99,
      spec: { inline: 'date', date: '2026-01-01' },
    });
    expect(serializeWithXml(session)).toContain('hello');
    expect(serializeWithXml(session)).toContain('2026-01-01');
  });
});

describe('Doc — chained block-type swaps stay addressable by the original id', () => {
  it('paragraph → heading → quote → paragraph: each swap mints a fresh id, the original id still resolves', () => {
    const { session, ids } = setup('Title');
    const id = ids[0]!;
    const doc = new Doc(session);
    doc.apply({ kind: 'setBlockType', node: id, block: 'heading', level: 2 });
    expect(serializeWithXml(session)).toContain('<h2');
    doc.apply({ kind: 'setBlockType', node: id, block: 'quote' });
    expect(serializeWithXml(session)).toContain('<blockquote');
    doc.apply({ kind: 'setBlockType', node: id, block: 'paragraph' });
    expect(serializeWithXml(session)).toContain('<p');
    // the original id chained through every swap and still resolves
    doc.apply({ kind: 'appendText', node: id, text: '!' });
    const xml = serializeWithXml(session);
    expect(xml).toContain('Title!');
    expect(xml).not.toContain(`id="${id}"`); // the live id is fresh, not the original
  });

  it('a child node stays addressable by its own id after the parent is swapped', () => {
    const { session, ids } = setup('hello world');
    const doc = new Doc(session);
    // grab the text node's durable id before the swap
    const childId = read(session, () =>
      $getId(($getRoot().getFirstChild() as ElementNode).getFirstChild()!)
    )!;
    doc.apply({
      kind: 'setBlockType',
      node: ids[0]!,
      block: 'heading',
      level: 2,
    });
    // the child rode along on replace(…, true): its id still resolves and formats
    doc.apply({ kind: 'formatNode', node: childId, format: 'bold', on: true });
    const xml = serializeWithXml(session);
    expect(xml).toContain('<h2');
    expect(xml).toContain('bold="true"');
    expect(xml).toContain('hello world');
  });
});

describe('Doc.setListType — preserves item ids', () => {
  it('toggling a paragraph into a bullet list produces a list with an addressable item', () => {
    const { session, ids } = setup('one');
    const doc = new Doc(session);
    doc.apply({ kind: 'setListType', nodes: [ids[0]!], list: 'bullet' });
    expect(serializeWithXml(session)).toContain('<ul');
    expect(serializeWithXml(session)).toContain('one');
    // the resulting list item has its own id, which resolves for a follow-up edit
    const itemId = childIds(session)[0]!;
    doc.apply({ kind: 'appendText', node: itemId, text: '!' });
    expect(serializeWithXml(session)).toContain('one!');
  });

  it('an existing bullet list switched to numbered keeps every item id', () => {
    const { session } = setup('- one\n- two');
    const before = childIds(session);
    new Doc(session).apply({
      kind: 'setListType',
      nodes: [before[0]!],
      list: 'number',
    });
    const after = childIds(session);
    expect(after).toEqual(before);
    expect(serializeWithXml(session)).toContain('<ol');
    expect(serializeWithXml(session)).toContain('one');
    expect(serializeWithXml(session)).toContain('two');
  });

  it('retypes a list addressed by its CONTAINER id (the <ul>/<ol>), not just an item', () => {
    // The model targets a list by the id it sees on the <ul> in the XML.
    const { session, ids } = setup('- one\n- two');
    const listId = ids[0]!; // top-level block IS the list container
    new Doc(session).apply({
      kind: 'setListType',
      nodes: [listId],
      list: 'number',
    });
    const xml = serializeWithXml(session);
    expect(xml).toContain('<ol'); // actually retyped, not mangled or no-op'd
    expect(xml).not.toContain('<ul');
    expect(xml).toContain('one');
    expect(xml).toContain('two');
  });
});

// ── refs ─────────────────────────────────────────────────────────────────────

describe('Doc — ref resolution', () => {
  it('insertNode then setText/appendText/bold target the ref', () => {
    const { session, ids } = setup('first');
    const doc = new Doc(session);
    doc.apply({
      kind: 'insertNode',
      ref: 'ref-x',
      spec: { block: 'paragraph', text: 'body' },
      at: { after: ids[0]! },
    });
    doc.apply({ kind: 'appendText', node: 'ref-x', text: '!' });
    doc.apply({
      kind: 'formatText',
      node: 'ref-x',
      match: 'body',
      format: 'bold',
      on: true,
      scope: { kind: 'all' },
    });
    const out = serializeWithXml(session);
    expect(out).toContain('first');
    expect(out).toContain('body');
    expect(out).toContain('!');
  });

  it('inserting two blocks mints two distinct ids', () => {
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
    // resolve both refs by editing each — both should succeed and stay distinct
    doc.apply({ kind: 'appendText', node: 'a', text: '1' });
    doc.apply({ kind: 'appendText', node: 'b', text: '2' });
    const out = serializeWithXml(session);
    expect(out).toContain('AA1');
    expect(out).toContain('BB2');
  });
});

// ── tables ─────────────────────────────────────────────────────────────────

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
    expect(doc.textLength(doc.cellNode('t', 0, 0))).toBe(4); // 'Head'
    expect(doc.textLength(doc.cellNode('t', 1, 0))).toBe(4); // 'body'
  });

  it('addRow appends a row with the right column count', () => {
    const { session, doc } = makeTable([
      ['H1', 'H2'],
      ['a', 'b'],
    ]);
    doc.apply({ kind: 'addRow', table: 't' });
    const cols = rowCellCounts(session);
    expect(cols).toEqual([2, 2, 2]); // 3 rows, all 2 cols
  });

  it('addRow at an index inserts before that row', () => {
    const { session, doc } = makeTable([
      ['H1', 'H2'],
      ['a', 'b'],
    ]);
    doc.apply({ kind: 'addRow', table: 't', at: 1 }); // before the body row
    doc.apply({ kind: 'setCell', table: 't', row: 1, col: 0, text: 'mid' });
    expect(serializeWithXml(session)).toContain('mid');
    expect(rowCellCounts(session)).toEqual([2, 2, 2]);
  });

  it('addColumn gives every row a new cell; the header-row cell is a header', () => {
    const { session, doc } = makeTable([
      ['H1', 'H2'],
      ['a', 'b'],
    ]);
    doc.apply({ kind: 'addColumn', table: 't' });
    expect(rowCellCounts(session)).toEqual([3, 3]);
    // header row's new cell is a header cell
    const headerStates = read(session, () => {
      const rows = tableRows(session);
      return rows[0]!
        .getChildren()
        .filter($isTableCellNode)
        .map((c) => c.getHeaderStyles());
    });
    expect(headerStates.at(-1)).not.toBe(0); // header bit set on the appended header cell
  });

  it('removeRow drops a row', () => {
    const { session, doc } = makeTable([
      ['H1', 'H2'],
      ['a', 'b'],
      ['c', 'd'],
    ]);
    doc.apply({ kind: 'removeRow', table: 't', row: 2 }); // drop the 'c d' row — use unique enough text
    expect(rowCellCounts(session)).toHaveLength(2);
    // check H1, H2, a, b are present but the dropped row content is gone
    expect(serializeWithXml(session)).toContain('>H1<');
    expect(serializeWithXml(session)).toContain('>H2<');
    expect(serializeWithXml(session)).toContain('>a<');
    expect(serializeWithXml(session)).toContain('>b<');
    expect(serializeWithXml(session)).not.toContain('>c<');
    expect(serializeWithXml(session)).not.toContain('>d<');
  });

  it('removeColumn drops the column from every row', () => {
    const { session, doc } = makeTable([
      ['H1', 'H2', 'H3'],
      ['aa', 'bb', 'cc'],
    ]);
    doc.apply({ kind: 'removeColumn', table: 't', col: 1 }); // drop the middle column
    expect(rowCellCounts(session)).toEqual([2, 2]);
    const out = serializeWithXml(session);
    expect(out).toContain('H1');
    expect(out).not.toContain('H2');
    expect(out).toContain('H3');
    expect(out).toContain('aa');
    expect(out).not.toContain('bb');
    expect(out).toContain('cc');
  });
});

function tableRows(session: Session) {
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
function rowCellCounts(session: Session): number[] {
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
    const { session } = setup('x');
    edit(session, () => {
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
    const { session } = setup('x');
    edit(session, () => {
      const n = buildNode(spec);
      expect(n.getType()).toBe(type);
    });
  });

  it('mention spec builds the right node types', () => {
    const { session } = setup('x');
    edit(session, () => {
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
    const { session, ids } = setup('intro');
    new Doc(session).apply({
      kind: 'insertNode',
      ref: 'l',
      spec: { block: 'list', list: 'bullet', items: ['one', 'two'] },
      at: { after: ids[0]! },
    });
    const out = serializeWithXml(session);
    expect(out).toContain('<ul');
    expect(out).toContain('one');
    expect(out).toContain('two');
  });

  it('inserting a code block serializes its language fence and text', () => {
    const { session, ids } = setup('intro');
    new Doc(session).apply({
      kind: 'insertNode',
      ref: 'c',
      spec: { block: 'code', language: 'ts', text: 'const a=1' },
      at: { after: ids[0]! },
    });
    // code block serializes as tokenized highlights in XML; check text content is present
    expect(serializeWithXml(session)).toContain('const');
    expect(serializeWithXml(session)).toContain('custom-code');
  });

});

// ── block-level decorator inserts (divider/image/video/equation) ──────────────

describe('Doc.insertNode — block decorator specs', () => {
  // divider/image/video/equation build DecoratorNodes (not ElementNodes); these
  // are still valid top-level blocks and must insert (insertNode rejects only
  // genuinely inline specs).
  const rootCount = (session: ReturnType<typeof setup>['session']) =>
    session.editor.getEditorState().read(() => $getRoot().getChildren().length);

  it('inserts a divider after a block', () => {
    const { session, ids } = setup('x');
    const before = rootCount(session);
    expect(() =>
      new Doc(session).apply({
        kind: 'insertNode',
        ref: 'd',
        spec: { block: 'divider' },
        at: { after: ids[0]! },
      })
    ).not.toThrow();
    expect(rootCount(session)).toBe(before + 1);
  });
  it('inserts a block image after a block', () => {
    const { session, ids } = setup('x');
    const before = rootCount(session);
    expect(() =>
      new Doc(session).apply({
        kind: 'insertNode',
        ref: 'i',
        spec: { block: 'image', srcType: 'url', url: 'http://i', alt: 'a' },
        at: { after: ids[0]! },
      })
    ).not.toThrow();
    expect(rootCount(session)).toBe(before + 1);
  });
  it('inserts a block equation after a block', () => {
    const { session, ids } = setup('x');
    const before = rootCount(session);
    expect(() =>
      new Doc(session).apply({
        kind: 'insertNode',
        ref: 'e',
        spec: { block: 'equation', tex: 'x^2' },
        at: { after: ids[0]! },
      })
    ).not.toThrow();
    expect(rootCount(session)).toBe(before + 1);
  });
  it('still rejects a genuinely inline spec', () => {
    const { session, ids } = setup('x');
    expect(() =>
      new Doc(session).apply({
        kind: 'insertNode',
        ref: 'lb',
        spec: { inline: 'linebreak' },
        at: { after: ids[0]! },
      })
    ).toThrow(/block spec/);
  });
});

// ── error surfacing ───────────────────────────────────────────────────────────

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
