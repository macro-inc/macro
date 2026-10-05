import { LoroDoc, LoroMap, LoroText } from 'loro-crdt';
import { describe, expect, it } from 'vitest';
import { DocxAgentError } from './agent-types';
import {
  describeWord,
  editWord,
  isWordFormat,
  WordDocument,
} from './word-agent';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const STYLES = `<w:styles xmlns:w="${W}"><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:next w:val="Normal"/></w:style><w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/></w:style></w:styles>`;

type Spec = {
  id: string;
  k: string;
  p?: string;
  o: string;
  x?: string;
  t?: Array<{ insert: string; attributes?: Record<string, string> }>;
};

/** A document in the engine's shared format. */
function shared(blocks: Spec[]): LoroDoc {
  const doc = new LoroDoc();
  doc.configDefaultTextStyle({ expand: 'none' });
  doc.getMap('docxMeta').set('formatVersion', 2);
  const parts = doc.getMap('wordParts');
  parts.set(
    '/word/document.xml',
    `<w:document xmlns:w="${W}"><w:body>\u0000BLOCKS\u0000</w:body></w:document>`
  );
  parts.set('/word/styles.xml', STYLES);
  const map = doc.getMap('wordBlocks');
  for (const b of blocks) {
    const m = map.setContainer(b.id, new LoroMap());
    m.set('k', b.k);
    m.set('p', b.p ?? '');
    m.set('o', b.o);
    m.set('a', '');
    m.set('x', b.x ?? '');
    if (b.k === 'p') {
      const text = m.setContainer('t', new LoroText());
      if (b.t?.length) text.applyDelta(b.t);
    }
  }
  doc.commit();
  return doc;
}

const TIMES = { 'r:w:rFonts': '<w:rFonts w:ascii="Times New Roman"/>' };

function sample() {
  return shared([
    {
      id: 'h1',
      k: 'p',
      o: 'A',
      x: '<w:pPr><w:pStyle w:val="Heading1"/></w:pPr>',
      t: [{ insert: '1. Term' }],
    },
    {
      id: 'p1',
      k: 'p',
      o: 'B',
      x: '<w:pPr><w:jc w:val="both"/><w:sectPr><w:pgSz w:w="12240"/></w:sectPr></w:pPr>',
      t: [
        { insert: 'The term is ', attributes: TIMES },
        { insert: '￼', attributes: { mark: '<w:bookmarkStart w:id="0"/>' } },
        {
          insert: 'two (2) years',
          attributes: { ...TIMES, 'r:w:b': '<w:b/>' },
        },
        {
          insert: ' old',
          attributes: { wrap: '[["<w:del w:id=\\"1\\">","</w:del>"]]' },
        },
        { insert: '.', attributes: TIMES },
      ],
    },
    { id: 't1', k: 'tbl', o: 'C' },
    { id: 'r1', k: 'tr', p: 't1', o: 'V' },
    { id: 'c1', k: 'tc', p: 'r1', o: 'V' },
    { id: 'cp', k: 'p', p: 'c1', o: 'V', t: [{ insert: 'Phase one' }] },
  ]);
}

const texts = (doc: LoroDoc) => {
  const word = new WordDocument(doc);
  const out: string[] = [];
  const walk = (parent: string) => {
    for (const b of word.kids(parent)) {
      if (b.kind === 'p') out.push(word.visible(b).text);
      walk(b.id);
    }
  };
  walk('');
  return out;
};

describe('Word documents in the shared format', () => {
  it('reads blocks with ids, styles, visible text and formatting', () => {
    const doc = sample();
    expect(isWordFormat(doc)).toBe(true);
    const read = describeWord(doc);
    expect(read).toContain('Word document with 3 blocks.');
    expect(read).toContain('#1 paragraph h1 (Heading1)');
    // Deleted text and markers are not part of what it says.
    expect(read).toContain(
      '#2 paragraph p1 (both)\n  The term is two (2) years.'
    );
    expect(read).toContain('bold: "two (2) years"');
    expect(read).toContain('#3 table t1, 1 rows x 1 columns');
    expect(read).toMatch(/row 1, cell 1:\n\s+paragraph cp\n\s+Phase one/);
    expect(read).toContain('Paragraph styles: Heading1,');
  });

  it('edits text, formatting, styles and paragraphs as CRDT operations', () => {
    const doc = sample();
    const peer = new LoroDoc();
    peer.import(doc.export({ mode: 'snapshot' }));
    const version = doc.version();
    const result = editWord(doc, [
      {
        type: 'replaceText',
        paragraph: 'p1',
        find: 'two (2) years',
        replace: 'three (3) years',
      },
      { type: 'formatText', paragraph: 'p1', find: 'term', italic: true },
      { type: 'setStyle', paragraph: 'p1', style: 'quote' },
      { type: 'insertParagraph', after: 'h1', text: 'First\nSecond' },
      { type: 'setText', paragraph: 'cp', text: 'Discovery' },
      { type: 'insertParagraph', after: 'cp', text: 'Weeks 1-2' },
    ]);
    expect(result).toContain('Applied 6 operations.');
    expect(texts(doc)).toEqual([
      '1. Term',
      'First',
      'Second',
      'The term is three (3) years.',
      'Discovery',
      'Weeks 1-2',
    ]);
    const word = new WordDocument(doc);
    const p1 = word.blocks.get('p1')!;
    // The replacement keeps the replaced text's formatting; the bookmark and
    // the deleted text stay where they were.
    const delta = word.spans(p1);
    expect(delta.find((s) => s.insert.startsWith('three'))?.attributes).toEqual(
      { ...TIMES, 'r:w:b': '<w:b/>' }
    );
    expect(word.text(p1).toString()).toContain('￼');
    expect(word.text(p1).toString()).toContain(' old');
    expect(delta.find((s) => s.insert === 'term')?.attributes?.['r:w:i']).toBe(
      '<w:i/>'
    );
    expect(word.propVal(p1, 'pStyle')).toBe('Quote');
    // A heading is followed by its next style; the section break stays put.
    const inserted = word.kids('')[1];
    expect(inserted.props).toBe('');
    // Paragraphs added after a body paragraph copy its properties, without
    // its section break.
    const cellParas = word.kids('c1');
    expect(cellParas.map((b) => b.parent)).toEqual(['c1', 'c1']);
    // Another peer merges the edit as an ordinary update.
    peer.import(doc.export({ mode: 'update', from: version }));
    expect(texts(peer)).toEqual(texts(doc));
  });

  it('copies paragraph properties without the section break', () => {
    const doc = sample();
    editWord(doc, [{ type: 'insertParagraph', after: 'p1', text: 'Next' }]);
    const word = new WordDocument(doc);
    const next = word.kids('')[2];
    expect(word.visible(next).text).toBe('Next');
    expect(next.props).toBe('<w:pPr><w:jc w:val="both"/></w:pPr>');
    // New text is formatted like the paragraph it follows.
    expect(word.spans(next)[0].attributes).toEqual(TIMES);
  });

  it('deletes blocks and refuses what the document cannot do', () => {
    const doc = sample();
    editWord(doc, [{ type: 'delete', id: 't1' }]);
    expect(texts(doc)).toEqual(['1. Term', 'The term is two (2) years.']);
    expect(new WordDocument(doc).blocks.has('cp')).toBe(false);
    const fails = (operations: Parameters<typeof editWord>[1]) => () =>
      editWord(sample(), operations);
    expect(fails([{ type: 'delete', id: 'nope' }])).toThrow(
      /No paragraph or block has id nope/
    );
    expect(fails([{ type: 'delete', id: 'cp' }])).toThrow(
      /only paragraph in its table cell/
    );
    expect(
      fails([{ type: 'replaceText', paragraph: 'p1', find: 'x', replace: 'y' }])
    ).toThrow(DocxAgentError);
    expect(
      fails([{ type: 'setStyle', paragraph: 'p1', style: 'Nope' }])
    ).toThrow(/no paragraph style "Nope"/);
  });
});
