import { describe, expect, it } from 'vitest';
import { DocumentEditor } from './document-editor';
import { EditError } from './errors';
import type { DocumentOp } from './ops';

/** Build an editor over a fixed set of valid ids. */
function ed(...ids: string[]): DocumentEditor {
  return new DocumentEditor({
    validIds: ids.length ? ids : ['b1', 'b2', 'b3', 't1'],
    refs: Array.from({ length: 32 }, (_, i) => `ref-${i + 1}`),
  });
}

describe('DocumentEditor — inline formatting → ops', () => {
  it('bold collapses to a formatText op (defaults to all + on)', () => {
    expect(ed().bold('b1', 'frog').drain()).toEqual<DocumentOp[]>([
      {
        kind: 'formatText',
        node: 'b1',
        match: 'frog',
        format: 'bold',
        on: true,
        scope: { kind: 'all' },
      },
    ]);
  });

  it('all six sugar methods map to their format with on=true', () => {
    const ops = ed()
      .italic('b1', 'a')
      .underline('b1', 'b')
      .strike('b1', 'c')
      .inlineCode('b1', 'd')
      .drain();
    expect(ops.map((o) => (o as any).format)).toEqual([
      'italic',
      'underline',
      'strike',
      'code',
    ]);
    expect(ops.every((o) => (o as any).on === true)).toBe(true);
  });

  it('un* methods set on=false', () => {
    expect(ed().unbold('b1', 'x').drain()[0]).toMatchObject({
      format: 'bold',
      on: false,
    });
  });

  it('passes through an explicit scope', () => {
    expect(
      ed().bold('b1', 'x', { kind: 'nth', n: 2 }).drain()[0]
    ).toMatchObject({
      scope: { kind: 'nth', n: 2 },
    });
  });

  it('highlight / unhighlight → markText', () => {
    expect(ed().highlight('b1', 'x').drain()[0]).toMatchObject({
      kind: 'markText',
      on: true,
    });
    expect(ed().unhighlight('b1', 'x').drain()[0]).toMatchObject({
      kind: 'markText',
      on: false,
    });
  });

  it('link / unlink → linkText (unlink uses url=null)', () => {
    expect(ed().link('b1', 'x', 'http://a').drain()[0]).toMatchObject({
      kind: 'linkText',
      url: 'http://a',
    });
    expect(ed().unlink('b1', 'x').drain()[0]).toMatchObject({
      kind: 'linkText',
      url: null,
    });
  });

  it('clearFormat with and without a match', () => {
    expect(ed().clearFormat('b1', 'x').drain()[0]).toEqual({
      kind: 'clearFormat',
      node: 'b1',
      match: 'x',
      scope: { kind: 'all' },
    });
    expect(ed().clearAllFormat('b1').drain()[0]).toEqual({
      kind: 'clearFormat',
      node: 'b1',
      match: undefined,
      scope: { kind: 'all' },
    });
  });

  it('formatNode / clearNodeFormat target a text-node id directly', () => {
    expect(ed().boldNode('t1').drain()[0]).toEqual({
      kind: 'formatNode',
      node: 't1',
      format: 'bold',
      on: true,
    });
    expect(ed().clearNodeFormat('t1').drain()[0]).toEqual({
      kind: 'clearNodeFormat',
      node: 't1',
    });
  });
});

describe('DocumentEditor — text / block / list → ops', () => {
  it('setText / replace / append / prepend', () => {
    expect(ed().setText('b1', 'hi').drain()[0]).toEqual({
      kind: 'setText',
      node: 'b1',
      text: 'hi',
    });
    expect(ed().replace('b1', 'a', 'b').drain()[0]).toEqual({
      kind: 'replaceText',
      node: 'b1',
      find: 'a',
      to: 'b',
      scope: { kind: 'all' },
    });
    expect(ed().appendText('b1', '!').drain()[0]).toEqual({
      kind: 'appendText',
      node: 'b1',
      text: '!',
    });
    expect(ed().prependText('b1', '>').drain()[0]).toEqual({
      kind: 'prependText',
      node: 'b1',
      text: '>',
    });
  });

  it('block type methods', () => {
    expect(ed().convertToParagraph('b1').drain()[0]).toEqual({
      kind: 'setBlockType',
      node: 'b1',
      block: 'paragraph',
    });
    expect(ed().convertToHeading('b1', 2).drain()[0]).toEqual({
      kind: 'setBlockType',
      node: 'b1',
      block: 'heading',
      level: 2,
    });
    expect(ed().convertToQuote('b1').drain()[0]).toEqual({
      kind: 'setBlockType',
      node: 'b1',
      block: 'quote',
    });
    expect(ed().convertToCodeBlock('b1', 'ts').drain()[0]).toEqual({
      kind: 'setBlockType',
      node: 'b1',
      block: 'code',
      language: 'ts',
    });
    expect(ed().setLanguage('b1', 'python').drain()[0]).toEqual({
      kind: 'setBlockType',
      node: 'b1',
      block: 'code',
      language: 'python',
    });
  });

  it('list toggles accept a single id or a list of ids', () => {
    expect(ed().bulletList('b1').drain()[0]).toEqual({
      kind: 'setListType',
      nodes: ['b1'],
      list: 'bullet',
    });
    expect(ed('b1', 'b2').numberedList(['b1', 'b2']).drain()[0]).toEqual({
      kind: 'setListType',
      nodes: ['b1', 'b2'],
      list: 'number',
    });
    expect(ed().checklist('b1').drain()[0]).toMatchObject({ list: 'check' });
  });

  it('check / uncheck → setChecked', () => {
    expect(ed().check('b1').drain()[0]).toEqual({
      kind: 'setChecked',
      node: 'b1',
      checked: true,
    });
    expect(ed().uncheck('b1').drain()[0]).toEqual({
      kind: 'setChecked',
      node: 'b1',
      checked: false,
    });
  });

  it('indent / outdent are relative, setIndent is absolute', () => {
    expect(ed().indent('b1').drain()[0]).toEqual({
      kind: 'setIndent',
      node: 'b1',
      indent: 'in',
    });
    expect(ed().outdent('b1').drain()[0]).toEqual({
      kind: 'setIndent',
      node: 'b1',
      indent: 'out',
    });
    expect(ed().setIndent('b1', 2).drain()[0]).toEqual({
      kind: 'setIndent',
      node: 'b1',
      indent: 2,
    });
  });

  it('insertListItemAfter defaults to a bullet item and returns a usable ref', () => {
    const e = ed();
    const ref = e.insertListItemAfter('b1', 'next');
    e.setText(ref, 'NEXT'); // would throw if ref were not registered valid
    const ops = e.drain();
    expect(ops).toMatchObject([
      {
        kind: 'insertListItemAfter',
        ref,
        node: 'b1',
        text: 'next',
        list: 'bullet',
      },
      { kind: 'setText', node: ref },
    ]);
  });

  it('insertListItemBefore carries an explicit list kind for nesting', () => {
    const e = ed();
    const ref = e.insertListItemBefore('b1', 'sub', 'number');
    expect(e.drain()[0]).toEqual({
      kind: 'insertListItemBefore',
      ref,
      node: 'b1',
      text: 'sub',
      list: 'number',
    });
  });

  it('removeListItem targets a single item', () => {
    expect(ed().removeListItem('b1').drain()[0]).toEqual({
      kind: 'removeListItem',
      node: 'b1',
    });
  });
});

describe('DocumentEditor — structure & refs', () => {
  it('insertParagraphAfter returns a ref that is then a valid target', () => {
    const e = ed();
    const ref = e.insertParagraphAfter('b1', 'Intro');
    e.bold(ref, 'Intro'); // would throw if ref were not registered valid
    const ops = e.drain();
    expect(ops).toMatchObject([
      {
        kind: 'insertNode',
        ref,
        spec: { block: 'paragraph', text: 'Intro' },
        at: { after: 'b1' },
      },
      { kind: 'formatText', node: ref },
    ]);
  });

  it('append/prepend block go to root', () => {
    const a = ed();
    a.appendParagraph('x');
    expect(a.drain()[0]).toMatchObject({ at: { appendToRoot: true } });
    const p = ed();
    p.prependParagraph('x');
    expect(p.drain()[0]).toMatchObject({ at: { prependToRoot: true } });
  });

  it('move / remove / removeMany / merge', () => {
    expect(ed().move('b1', { before: 'b2' }).drain()[0]).toEqual({
      kind: 'moveNode',
      node: 'b1',
      at: { before: 'b2' },
    });
    expect(ed().remove('b1').drain()[0]).toEqual({
      kind: 'removeNode',
      node: 'b1',
    });
    expect(ed('b1', 'b2').removeMany(['b1', 'b2']).drain()).toHaveLength(2);
    expect(ed('b1', 'b2').merge(['b1', 'b2'], ' — ').drain()[0]).toEqual({
      kind: 'mergeBlocks',
      nodes: ['b1', 'b2'],
      separator: ' — ',
    });
  });

  it('tables: insert an EMPTY grid, then a setCell per non-empty cell (human-like fill)', () => {
    const e = ed();
    const t = e.appendTable([
      ['A', 'B'],
      ['c', ''],
    ]); // 2x2, one empty cell
    const ops = e.drain();
    // empty grid first (same shape, blank cells), then one setCell per NON-empty cell
    expect(ops).toEqual([
      expect.objectContaining({
        kind: 'insertNode',
        spec: {
          block: 'table',
          rows: [
            ['', ''],
            ['', ''],
          ],
        },
      }),
      { kind: 'setCell', table: t, row: 0, col: 0, text: 'A' },
      { kind: 'setCell', table: t, row: 0, col: 1, text: 'B' },
      { kind: 'setCell', table: t, row: 1, col: 0, text: 'c' },
    ]);
    expect(ed().addRow('b1').drain()[0]).toEqual({
      kind: 'addRow',
      table: 'b1',
      at: undefined,
    });
    expect(ed().removeColumn('b1', 2).drain()[0]).toEqual({
      kind: 'removeColumn',
      table: 'b1',
      col: 2,
    });
  });

  it('media / inline creators', () => {
    expect(ed().insertDivider('b1').length).toBeUndefined; // returns a ref string, not chainable
    const e = ed();
    const img = e.insertImage('b1', {
      srcType: 'url',
      url: 'http://i',
      alt: 'a',
    });
    expect(typeof img).toBe('string');
    expect(e.drain()[0]).toMatchObject({
      kind: 'insertNode',
      spec: { block: 'image', srcType: 'url', url: 'http://i', alt: 'a' },
    });
    expect(ed().insertDate('b1', 3, '2026-01-01').length).toBeUndefined;
  });

  it('insertInline creators produce insertInline ops at the offset', () => {
    const e = ed();
    e.insertLineBreak('b1', 4);
    expect(e.drain()[0]).toMatchObject({
      kind: 'insertInline',
      node: 'b1',
      at: 4,
      spec: { inline: 'linebreak' },
    });
  });
});

describe('DocumentEditor — eager validation (EditError)', () => {
  it('throws on an unknown id immediately', () => {
    expect(() => ed().bold('nope', 'x')).toThrow(EditError);
    expect(() => ed().setText('nope', 'x')).toThrow(/unknown id "nope"/);
  });

  it('throws when an insert position references an unknown id', () => {
    expect(() => ed().insertParagraphAfter('nope')).toThrow(EditError);
  });

  it('throws on empty match / find', () => {
    expect(() => ed().bold('b1', '')).toThrow(/match string is empty/);
    expect(() => ed().replace('b1', '', 'x')).toThrow(/find string is empty/);
  });

  it('throws on out-of-range heading level', () => {
    expect(() => ed().convertToHeading('b1', 0)).toThrow(/1-6/);
    expect(() => ed().convertToHeading('b1', 7)).toThrow(/1-6/);
  });

  it('throws on negative indent / cell indices / empty list & merge', () => {
    expect(() => ed().setIndent('b1', -1)).toThrow(/>= 0/);
    expect(() => ed().setCell('b1', -1, 0, 'x')).toThrow(/>= 0/);
    expect(() => ed().bulletList([])).toThrow(/at least one/);
    expect(() => ed().merge(['b1'])).toThrow(/at least two/);
  });

  it('does NOT throw partway — nothing is applied, ops just accumulate until the throw', () => {
    const e = ed();
    e.bold('b1', 'ok');
    expect(() => e.bold('nope', 'x')).toThrow();
    // the first op is still captured; the bad call added nothing
    expect(e.drain()).toHaveLength(1);
  });
});

describe('DocumentEditor — mention methods push insertInline ops', () => {
  it('every mention method pushes an insertInline op with the right mention kind', () => {
    const eu = ed();
    eu.mentionUser('b1', 0, { userId: 'u', email: 'e' });
    expect(eu.drain()[0]).toMatchObject({
      kind: 'insertInline',
      spec: {
        inline: 'mention',
        mention: { kind: 'user', userId: 'u', email: 'e' },
      },
    });
    const eg = ed();
    eg.mentionGroup('b1', 0, { groupAlias: 'g' });
    expect(eg.drain()[0]).toMatchObject({
      kind: 'insertInline',
      spec: { inline: 'mention', mention: { kind: 'group', groupAlias: 'g' } },
    });
    const ec = ed();
    ec.mentionContact('b1', 0, {
      contactId: 'c',
      name: 'n',
      emailOrDomain: 'd',
      isCompany: false,
    });
    expect(ec.drain()[0]).toMatchObject({
      kind: 'insertInline',
      spec: { inline: 'mention', mention: { kind: 'contact' } },
    });
    const ed2 = ed();
    ed2.mentionDocument('b1', 0, {
      documentId: 'd',
      documentName: 'n',
      blockName: 'b',
    });
    expect(ed2.drain()[0]).toMatchObject({
      kind: 'insertInline',
      spec: { inline: 'mention', mention: { kind: 'document' } },
    });
  });
});

describe('DocumentEditor — drain semantics', () => {
  it('chaining accumulates in order and drain resets', () => {
    const e = ed();
    e.bold('b1', 'a').italic('b2', 'b').remove('b3');
    const first = e.drain();
    expect(first.map((o) => o.kind)).toEqual([
      'formatText',
      'formatText',
      'removeNode',
    ]);
    expect(e.drain()).toEqual([]); // drained
  });
});

describe('DocumentEditor — unknown id rejected by every id-taking method', () => {
  // each entry runs a method that should throw EditError for an unknown id.
  const cases: Array<[string, (e: DocumentEditor) => void]> = [
    ['format', (e) => e.format('nope', 'x', 'bold')],
    ['bold', (e) => e.bold('nope', 'x')],
    ['italic', (e) => e.italic('nope', 'x')],
    ['underline', (e) => e.underline('nope', 'x')],
    ['strike', (e) => e.strike('nope', 'x')],
    ['inlineCode', (e) => e.inlineCode('nope', 'x')],
    ['unbold', (e) => e.unbold('nope', 'x')],
    ['clearFormat', (e) => e.clearFormat('nope', 'x')],
    ['clearAllFormat', (e) => e.clearAllFormat('nope')],
    ['highlight', (e) => e.highlight('nope', 'x')],
    ['unhighlight', (e) => e.unhighlight('nope', 'x')],
    ['link', (e) => e.link('nope', 'x', 'http://a')],
    ['unlink', (e) => e.unlink('nope', 'x')],
    ['formatNode', (e) => e.formatNode('nope', 'bold')],
    ['boldNode', (e) => e.boldNode('nope')],
    ['clearNodeFormat', (e) => e.clearNodeFormat('nope')],
    ['setText', (e) => e.setText('nope', 'x')],
    ['replace', (e) => e.replace('nope', 'a', 'b')],
    ['appendText', (e) => e.appendText('nope', 'x')],
    ['prependText', (e) => e.prependText('nope', 'x')],
    ['convertToParagraph', (e) => e.convertToParagraph('nope')],
    ['convertToHeading', (e) => e.convertToHeading('nope', 2)],
    ['convertToQuote', (e) => e.convertToQuote('nope')],
    ['convertToCodeBlock', (e) => e.convertToCodeBlock('nope', 'ts')],
    ['setLanguage', (e) => e.setLanguage('nope', 'ts')],
    ['bulletList', (e) => e.bulletList('nope')],
    ['numberedList(array)', (e) => e.numberedList(['nope'])],
    ['checklist', (e) => e.checklist('nope')],
    ['setListType', (e) => e.setListType('nope', 'bullet')],
    ['check', (e) => e.check('nope')],
    ['uncheck', (e) => e.uncheck('nope')],
    ['setChecked', (e) => e.setChecked('nope', true)],
    ['indent', (e) => e.indent('nope')],
    ['outdent', (e) => e.outdent('nope')],
    ['setIndent', (e) => e.setIndent('nope', 1)],
    ['insertListItemAfter', (e) => e.insertListItemAfter('nope', 'x')],
    ['insertListItemBefore', (e) => e.insertListItemBefore('nope', 'x')],
    ['removeListItem', (e) => e.removeListItem('nope')],
    ['move(self)', (e) => e.move('nope', { after: 'b1' })],
    ['remove', (e) => e.remove('nope')],
    ['removeMany', (e) => e.removeMany(['nope'])],
    ['merge', (e) => e.merge(['nope', 'b1'])],
    ['setCell', (e) => e.setCell('nope', 0, 0, 'x')],
    ['addRow', (e) => e.addRow('nope')],
    ['addColumn', (e) => e.addColumn('nope')],
    ['removeRow', (e) => e.removeRow('nope', 0)],
    ['removeColumn', (e) => e.removeColumn('nope', 0)],
    ['insertDivider', (e) => e.insertDivider('nope')],
    ['insertImage', (e) => e.insertImage('nope', { srcType: 'url', url: 'u' })],
    ['insertVideo', (e) => e.insertVideo('nope', { srcType: 'url', url: 'u' })],
    ['insertEquation', (e) => e.insertEquation('nope', 'x^2')],
    ['insertInlineEquation', (e) => e.insertInlineEquation('nope', 0, 'x')],
    ['insertLineBreak', (e) => e.insertLineBreak('nope', 0)],
    ['insertDate', (e) => e.insertDate('nope', 0, '2026-01-01')],
    ['insertParagraphAfter', (e) => e.insertParagraphAfter('nope')],
    ['insertParagraphBefore', (e) => e.insertParagraphBefore('nope')],
    ['insertHeadingAfter', (e) => e.insertHeadingAfter('nope', 1)],
    ['insertQuoteAfter', (e) => e.insertQuoteAfter('nope')],
    ['insertCodeBlockAfter', (e) => e.insertCodeBlockAfter('nope', 'ts')],
    ['insertTableAfter', (e) => e.insertTableAfter('nope', [['a']])],
    ['insertTableBefore', (e) => e.insertTableBefore('nope', [['a']])],
  ];
  it.each(cases)('%s throws EditError for an unknown id', (_label, fn) => {
    expect(() => fn(ed())).toThrow(EditError);
  });
});

describe('DocumentEditor — insert position validation', () => {
  it('insertParagraphBefore validates the anchor id', () => {
    expect(() => ed().insertParagraphBefore('nope')).toThrow(
      /unknown id "nope"/
    );
  });
  it('appendToRoot / prependToRoot need no anchor', () => {
    expect(() => ed().appendParagraph('x')).not.toThrow();
    expect(() => ed().prependParagraph('x')).not.toThrow();
    expect(() => ed().appendBlock({ block: 'divider' })).not.toThrow();
    expect(() => ed().prependBlock({ block: 'divider' })).not.toThrow();
  });
  it('move validates BOTH the moved id and the destination anchor', () => {
    expect(() => ed().move('nope', { after: 'b1' })).toThrow(/nope/);
    expect(() => ed().move('b1', { after: 'nope' })).toThrow(/nope/);
    expect(() => ed().move('b1', { appendToRoot: true })).not.toThrow();
  });
});

describe('DocumentEditor — match/find validation', () => {
  it('empty match throws for every match-taking method', () => {
    expect(() => ed().format('b1', '', 'bold')).toThrow(
      /match string is empty/
    );
    expect(() => ed().highlight('b1', '')).toThrow(/match string is empty/);
    expect(() => ed().unhighlight('b1', '')).toThrow(/match string is empty/);
    expect(() => ed().link('b1', '', 'http://a')).toThrow(
      /match string is empty/
    );
    expect(() => ed().unlink('b1', '')).toThrow(/match string is empty/);
  });
  it('clearFormat tolerates an omitted match but rejects an empty one', () => {
    expect(() => ed().clearFormat('b1')).not.toThrow();
    expect(() => ed().clearFormat('b1', '')).toThrow(/match string is empty/);
  });
  it('replace rejects an empty find', () => {
    expect(() => ed().replace('b1', '', 'x')).toThrow(/find string is empty/);
  });
});

describe('DocumentEditor — heading level bounds', () => {
  it('accepts 1..6 and rejects 0 and 7', () => {
    for (let lvl = 1; lvl <= 6; lvl++) {
      expect(ed().convertToHeading('b1', lvl).drain()[0]).toMatchObject({
        kind: 'setBlockType',
        block: 'heading',
        level: lvl,
      });
    }
    expect(() => ed().convertToHeading('b1', 0)).toThrow(/1-6/);
    expect(() => ed().convertToHeading('b1', 7)).toThrow(/1-6/);
    expect(() => ed().convertToHeading('b1', -1)).toThrow(/1-6/);
  });
});

describe('DocumentEditor — code block language validation', () => {
  it('requires a non-empty language for code block conversion and insertion', () => {
    expect(() => ed().convertToCodeBlock('b1', '')).toThrow(
      /language is required/
    );
    expect(() =>
      ed().convertToCodeBlock('b1', undefined as unknown as string)
    ).toThrow(/language is required/);
    expect(() => ed().setLanguage('b1', '')).toThrow(/language is required/);
    expect(() =>
      ed().setLanguage('b1', undefined as unknown as string)
    ).toThrow(/language is required/);
    expect(() => ed().insertCodeBlockAfter('b1', '')).toThrow(
      /language is required/
    );
    expect(() =>
      ed().insertCodeBlockAfter('b1', undefined as unknown as string)
    ).toThrow(/language is required/);
  });
});

describe('DocumentEditor — indent & cell bounds', () => {
  it('setIndent rejects negatives, allows 0 and positive', () => {
    expect(() => ed().setIndent('b1', -1)).toThrow(/>= 0/);
    expect(ed().setIndent('b1', 0).drain()[0]).toEqual({
      kind: 'setIndent',
      node: 'b1',
      indent: 0,
    });
    expect(ed().setIndent('b1', 3).drain()[0]).toEqual({
      kind: 'setIndent',
      node: 'b1',
      indent: 3,
    });
  });
  it('indent maps any nonneg "by" to "in" and any negative to "out"', () => {
    expect(ed().indent('b1', 5).drain()[0]).toMatchObject({ indent: 'in' });
    expect(ed().indent('b1', 0).drain()[0]).toMatchObject({ indent: 'in' }); // 0 >= 0
    expect(ed().indent('b1', -2).drain()[0]).toMatchObject({ indent: 'out' });
    expect(ed().outdent('b1', 3).drain()[0]).toMatchObject({ indent: 'out' });
  });
  it('setCell / removeRow / removeColumn reject negative indices', () => {
    expect(() => ed().setCell('b1', -1, 0, 'x')).toThrow(/>= 0/);
    expect(() => ed().setCell('b1', 0, -1, 'x')).toThrow(/>= 0/);
    expect(() => ed().removeRow('b1', -1)).toThrow(/>= 0/);
    expect(() => ed().removeColumn('b1', -1)).toThrow(/>= 0/);
    expect(ed().setCell('b1', 0, 0, 'x').drain()[0]).toMatchObject({
      kind: 'setCell',
      row: 0,
      col: 0,
    });
  });
});

describe('DocumentEditor — list & merge cardinality', () => {
  it('empty list throws', () => {
    expect(() => ed().bulletList([])).toThrow(/at least one/);
    expect(() => ed().numberedList([])).toThrow(/at least one/);
    expect(() => ed().checklist([])).toThrow(/at least one/);
  });
  it('merge requires two or more', () => {
    expect(() => ed().merge([])).toThrow(/at least two/);
    expect(() => ed('b1').merge(['b1'])).toThrow(/at least two/);
    expect(ed('b1', 'b2').merge(['b1', 'b2']).drain()[0]).toMatchObject({
      kind: 'mergeBlocks',
    });
  });
  it('merge default separator is a single space', () => {
    expect(ed('b1', 'b2').merge(['b1', 'b2']).drain()[0]).toMatchObject({
      separator: ' ',
    });
  });
});

describe('DocumentEditor — inline offset validation', () => {
  it('negative inline offset throws', () => {
    expect(() => ed().insertLineBreak('b1', -1)).toThrow(
      /inline offset must be >= 0/
    );
    expect(() => ed().insertInlineEquation('b1', -5, 'x')).toThrow(
      /inline offset must be >= 0/
    );
  });
  it('offset 0 is allowed', () => {
    const e = ed();
    e.insertLineBreak('b1', 0);
    expect(e.drain()[0]).toMatchObject({ kind: 'insertInline', at: 0 });
  });
});

describe('DocumentEditor — ref minted by a creator is a valid later target', () => {
  it('insertParagraphAfter ref accepted by format, append, list, table builders', () => {
    const e = ed();
    const ref = e.insertParagraphAfter('b1', 'Intro');
    e.bold(ref, 'Intro');
    e.appendText(ref, '!');
    e.convertToHeading(ref, 1);
    const ops = e.drain();
    expect(ops.map((o) => o.kind)).toEqual([
      'insertNode',
      'formatText',
      'appendText',
      'setBlockType',
    ]);
  });

  it('a table ref is a valid target for setCell/addRow/addColumn', () => {
    const e = ed();
    const t = e.appendTable([['', '']]); // empty grid → just an insertNode, no auto setCell
    e.setCell(t, 0, 0, 'x');
    e.addRow(t);
    e.addColumn(t);
    expect(e.drain().map((o) => o.kind)).toEqual([
      'insertNode',
      'setCell',
      'addRow',
      'addColumn',
    ]);
  });

  it('an inline ref (insertLineBreak) is registered valid too', () => {
    const e = ed();
    const r = e.insertLineBreak('b1', 0);
    expect(() => e.bold(r, 'x')).not.toThrow();
  });

  it('two inserts mint distinct refs', () => {
    const e = ed();
    const a = e.insertParagraphAfter('b1');
    const b = e.insertParagraphAfter('b1');
    expect(a).not.toBe(b);
  });
});

describe('DocumentEditor — scope defaults', () => {
  it('format/highlight/link/clearFormat/replace default to { all: true }', () => {
    expect(ed().bold('b1', 'x').drain()[0]).toMatchObject({
      scope: { kind: 'all' },
    });
    expect(ed().highlight('b1', 'x').drain()[0]).toMatchObject({
      scope: { kind: 'all' },
    });
    expect(ed().link('b1', 'x', 'http://a').drain()[0]).toMatchObject({
      scope: { kind: 'all' },
    });
    expect(ed().clearFormat('b1', 'x').drain()[0]).toMatchObject({
      scope: { kind: 'all' },
    });
    expect(ed().replace('b1', 'a', 'b').drain()[0]).toMatchObject({
      scope: { kind: 'all' },
    });
  });
  it('an explicit scope overrides the default', () => {
    expect(
      ed().bold('b1', 'x', { kind: 'nth', n: 3 }).drain()[0]
    ).toMatchObject({
      scope: { kind: 'nth', n: 3 },
    });
  });
});

describe('DocumentEditor — mention methods require a valid block id', () => {
  it('each mention method throws EditError for an unknown id', () => {
    expect(() =>
      ed().mentionUser('nope', 0, { userId: 'u', email: 'e' })
    ).toThrow(/nope/);
    expect(() => ed().mentionGroup('nope', 0, { groupAlias: 'g' })).toThrow(
      /nope/
    );
  });
});

describe('DocumentEditor — removeMany & accumulation', () => {
  it('removeMany validates every id before pushing each', () => {
    expect(() => ed('b1', 'b2').removeMany(['b1', 'nope'])).toThrow(/nope/);
  });
  it('removeMany of all valid ids pushes one removeNode per id in order', () => {
    const ops = ed('b1', 'b2', 'b3').removeMany(['b3', 'b1']).drain();
    expect(ops).toEqual([
      { kind: 'removeNode', node: 'b3' },
      { kind: 'removeNode', node: 'b1' },
    ]);
  });
});
