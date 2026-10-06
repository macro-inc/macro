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

const NOW = new Date('2026-10-05T12:08:31.250Z');
const AS_JACOB = { author: 'Jacob Beckerman', now: NOW };

/** Spans of a paragraph whose wrappers include a `local` revision. */
const revised = (doc: LoroDoc, id: string, local: 'ins' | 'del') => {
  const word = new WordDocument(doc);
  return word
    .spans(word.blocks.get(id)!)
    .filter((s) => s.attributes?.wrap?.includes(`<w:${local} `))
    .map((s) => s.insert);
};

describe('Tracked changes', () => {
  it('records a replacement as a deletion followed by an insertion', () => {
    const doc = sample();
    const result = editWord(
      doc,
      [
        {
          type: 'replaceText',
          paragraph: 'p1',
          find: 'two (2) years',
          replace: 'three (3) years',
        },
      ],
      { trackChanges: true, ...AS_JACOB }
    );
    expect(result).toContain('tracked changes by Jacob Beckerman');
    const word = new WordDocument(doc);
    const spans = word.spans(word.blocks.get('p1')!);
    const deleted = spans.find((s) => s.insert === 'two (2) years')!;
    const del = JSON.parse(deleted.attributes!.wrap) as string[][];
    expect(del).toHaveLength(1);
    expect(del[0][0]).toMatch(
      /^<w:del w:id="\d+" w:author="Jacob Beckerman" w:date="2026-10-05T12:08:31Z">$/
    );
    // The deleted text keeps its formatting; the insertion takes it too.
    expect(deleted.attributes!['r:w:b']).toBe('<w:b/>');
    const inserted = spans[spans.indexOf(deleted) + 1];
    expect(inserted.insert).toBe('three (3) years');
    expect(inserted.attributes!['r:w:b']).toBe('<w:b/>');
    expect(inserted.attributes!.wrap).toMatch(
      /^\[\["<w:ins w:id=\\"\d+\\" w:author=\\"Jacob Beckerman\\"/
    );
    // Readers see the text as if the change were accepted, plus the redline.
    expect(texts(doc)[1]).toBe('The term is three (3) years.');
    const read = describeWord(doc);
    expect(read).toContain('deleted by Jacob Beckerman: "two (2) years"');
    expect(read).toContain('inserted by Jacob Beckerman: "three (3) years"');
  });

  it('follows the document setting and removes the author’s own insertions', () => {
    const doc = sample();
    doc
      .getMap('wordParts')
      .set(
        '/word/settings.xml',
        `<w:settings xmlns:w="${W}"><w:trackRevisions/></w:settings>`
      );
    doc.commit();
    expect(describeWord(doc)).toContain('Track Changes is on');
    editWord(
      doc,
      [{ type: 'setText', paragraph: 'cp', text: 'Discovery' }],
      AS_JACOB
    );
    expect(revised(doc, 'cp', 'del')).toEqual(['Phase one']);
    expect(revised(doc, 'cp', 'ins')).toEqual(['Discovery']);
    // Rewriting your own insertion replaces it rather than stacking revisions.
    editWord(
      doc,
      [{ type: 'setText', paragraph: 'cp', text: 'Design' }],
      AS_JACOB
    );
    expect(revised(doc, 'cp', 'del')).toEqual(['Phase one']);
    expect(revised(doc, 'cp', 'ins')).toEqual(['Design']);
    // Someone else's insertion is marked deleted instead.
    editWord(doc, [{ type: 'setText', paragraph: 'cp', text: 'Build' }], {
      author: 'Opposing Counsel',
      now: NOW,
    });
    expect(revised(doc, 'cp', 'del')).toEqual(['Phase one', 'Design']);
    // trackChanges false edits directly even though the document tracks.
    editWord(doc, [{ type: 'setText', paragraph: 'h1', text: 'Term' }], {
      trackChanges: false,
      ...AS_JACOB,
    });
    expect(revised(doc, 'h1', 'del')).toEqual([]);
    expect(texts(doc)[0]).toBe('Term');
  });

  it('marks inserted paragraphs and their marks', () => {
    const doc = sample();
    editWord(
      doc,
      [{ type: 'insertParagraph', after: 'p1', text: 'New clause' }],
      { trackChanges: true, ...AS_JACOB }
    );
    const word = new WordDocument(doc);
    const added = word.kids('')[2];
    expect(word.visible(added).text).toBe('New clause');
    expect(added.props).toMatch(
      /^<w:pPr><w:jc w:val="both"\/><w:rPr><w:ins w:id="\d+" w:author="Jacob Beckerman" w:date="[^"]+"\/><\/w:rPr><\/w:pPr>$/
    );
    expect(revised(doc, added.id, 'ins')).toEqual(['New clause']);
    expect(describeWord(doc)).toContain(
      'inserted paragraph by Jacob Beckerman'
    );
  });

  it('deletes paragraphs and tables as revisions', () => {
    const doc = sample();
    editWord(
      doc,
      [
        { type: 'delete', id: 'h1' },
        { type: 'delete', id: 't1' },
      ],
      { trackChanges: true, ...AS_JACOB }
    );
    const word = new WordDocument(doc);
    // Nothing is removed: the text and the paragraph mark are marked deleted.
    expect(word.blocks.has('h1')).toBe(true);
    expect(revised(doc, 'h1', 'del')).toEqual(['1. Term']);
    expect(word.blocks.get('h1')!.props).toContain('<w:rPr><w:del w:id="');
    expect(word.blocks.get('r1')!.props).toMatch(
      /^<w:trPr><w:del w:id="\d+" w:author="Jacob Beckerman"/
    );
    expect(revised(doc, 'cp', 'del')).toEqual(['Phase one']);
    // The last paragraph of a cell keeps its mark.
    expect(word.blocks.get('cp')!.props).toBe('');
    // A paragraph the author inserted is simply removed again.
    editWord(doc, [{ type: 'insertParagraph', after: 'p1', text: 'Oops' }], {
      trackChanges: true,
      ...AS_JACOB,
    });
    const oops = new WordDocument(doc).kids('')[2].id;
    editWord(doc, [{ type: 'delete', id: oops }], {
      trackChanges: true,
      ...AS_JACOB,
    });
    expect(new WordDocument(doc).blocks.has(oops)).toBe(false);
  });

  it('records formatting and style changes', () => {
    const doc = sample();
    editWord(
      doc,
      [
        { type: 'formatText', paragraph: 'p1', find: 'term', italic: true },
        { type: 'formatText', paragraph: 'h1', bold: false },
        { type: 'setStyle', paragraph: 'p1', style: 'Quote' },
      ],
      { trackChanges: true, ...AS_JACOB }
    );
    const word = new WordDocument(doc);
    const term = word
      .spans(word.blocks.get('p1')!)
      .find((s) => s.insert === 'term')!;
    expect(term.attributes!['r:w:i']).toBe('<w:i/>');
    expect(term.attributes!['r:w:rPrChange']).toMatch(
      /^<w:rPrChange w:id="\d+" w:author="Jacob Beckerman" w:date="[^"]+"><w:rPr><w:rFonts w:ascii="Times New Roman"\/><\/w:rPr><\/w:rPrChange>$/
    );
    // Turning off what was not on changes nothing to record.
    const heading = word.spans(word.blocks.get('h1')!)[0];
    expect(heading.attributes!['r:w:rPrChange']).toBeUndefined();
    expect(word.blocks.get('p1')!.props).toMatch(
      /^<w:pPr><w:pStyle w:val="Quote"\/><w:jc w:val="both"\/><w:sectPr><w:pgSz w:w="12240"\/><\/w:sectPr><w:pPrChange w:id="\d+" w:author="Jacob Beckerman" w:date="[^"]+"><w:pPr><w:jc w:val="both"\/><\/w:pPr><\/w:pPrChange><\/w:pPr>$/
    );
    const read = describeWord(doc);
    expect(read).toContain('formatting changed by Jacob Beckerman: "term"');
    expect(read).toContain('properties changed by Jacob Beckerman');
  });
});

describe('Word comments', () => {
  it('writes comments into the file, attributed to the author', () => {
    const doc = sample();
    const result = editWord(
      doc,
      [
        {
          type: 'addComment',
          paragraph: 'p1',
          find: 'two (2) years',
          text: 'We need three.\nSee the term sheet.',
        },
        { type: 'addComment', paragraph: 'cp', text: 'R&D <first>' },
      ],
      AS_JACOB
    );
    expect(result).toContain('Added Word comments 0, 1 by Jacob Beckerman');
    const parts = doc.getMap('wordParts');
    expect(parts.get('/word/comments.xml')).toBe(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:comments xmlns:w="${W}">` +
        '<w:comment w:id="0" w:author="Jacob Beckerman" w:date="2026-10-05T12:08:31Z" w:initials="JB"><w:p><w:r><w:annotationRef/></w:r><w:r><w:t xml:space="preserve">We need three.</w:t></w:r></w:p><w:p><w:r><w:t xml:space="preserve">See the term sheet.</w:t></w:r></w:p></w:comment>' +
        '<w:comment w:id="1" w:author="Jacob Beckerman" w:date="2026-10-05T12:08:31Z" w:initials="JB"><w:p><w:r><w:annotationRef/></w:r><w:r><w:t xml:space="preserve">R&amp;D &lt;first&gt;</w:t></w:r></w:p></w:comment>' +
        '</w:comments>'
    );
    expect(doc.getMap('wordTypes').get('override|/word/comments.xml')).toBe(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml'
    );
    const rels = doc.getMap('wordRels');
    const [key] = rels.keys();
    expect(key).toMatch(/^\/word\/_rels\/document\.xml\.rels\|rId\d+$/);
    expect(rels.get(key)).toMatch(
      /^<Relationship Id="rId\d+" Type="http:\/\/schemas\.openxmlformats\.org\/officeDocument\/2006\/relationships\/comments" Target="comments\.xml"\/>$/
    );
    // The range markers wrap the text and the reference follows it.
    const word = new WordDocument(doc);
    const spans = word.spans(word.blocks.get('p1')!);
    const at = spans.findIndex((s) => s.insert === 'two (2) years');
    expect(spans[at - 1].attributes).toEqual({
      mark: '<w:commentRangeStart w:id="0"/>',
    });
    expect(spans[at + 1].attributes).toEqual({
      mark: '<w:commentRangeEnd w:id="0"/>',
    });
    expect(spans[at + 2].attributes).toEqual({
      obj: '<w:commentReference w:id="0"/>',
    });
    expect(texts(doc)[1]).toBe('The term is two (2) years.');
    const read = describeWord(doc);
    expect(read).toContain(
      'comment 0 by Jacob Beckerman on "two (2) years": We need three. See the term sheet.'
    );
    expect(read).toContain(
      'comment 1 by Jacob Beckerman on "Phase one": R&D <first>'
    );

    // A later comment joins the existing part with the next id.
    editWord(doc, [{ type: 'addComment', paragraph: 'h1', text: 'Agreed' }], {
      author: 'Opposing Counsel',
      now: NOW,
    });
    expect(String(parts.get('/word/comments.xml'))).toContain(
      '<w:comment w:id="2" w:author="Opposing Counsel" w:date="2026-10-05T12:08:31Z" w:initials="OC">'
    );
    expect([...rels.keys()]).toHaveLength(1);
    expect(describeWord(doc)).toContain(
      'comment 2 by Opposing Counsel on "1. Term": Agreed'
    );
  });

  it('refuses empty comments without changing anything', () => {
    const doc = sample();
    expect(() =>
      editWord(doc, [{ type: 'addComment', paragraph: 'p1', text: ' ' }])
    ).toThrow(/needs comment text/);
    expect(doc.getMap('wordParts').get('/word/comments.xml')).toBeUndefined();
  });
});
