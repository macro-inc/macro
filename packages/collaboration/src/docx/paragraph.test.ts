import { describe, expect, it } from 'vitest';
import { blockContaining } from './fixtures/load';
import {
  createParagraph,
  formatRange,
  type Names,
  paragraphStyle,
  paragraphText,
  replaceRange,
  runFormat,
  segments,
  setParagraphStyle,
} from './paragraph';
import { parseElement, serializeXml, type XmlElement } from './xml';

const names: Names = { w: 'w', pt: 'p18' };

function load(text: string) {
  return parseElement(blockContaining('mutual-nda', text).xml);
}

const unids = (xml: string) =>
  [...xml.matchAll(/p18:Unid="([0-9a-f]{32})"/g)].map((match) => match[1]);

function expectUniqueIds(node: XmlElement) {
  const ids = unids(serializeXml(node));
  expect(new Set(ids).size).toBe(ids.length);
}

/** Text of each run with whether it is bold, for formatting assertions. */
const boldRuns = (paragraph: XmlElement) => {
  const runs = new Map<XmlElement, string>();
  for (const segment of segments(paragraph, names))
    runs.set(segment.run, (runs.get(segment.run) ?? '') + segment.text);
  return [...runs].map(
    ([run, text]) => `${runFormat(run, names).bold ? 'B' : '-'}${text}`
  );
};

describe('paragraph text', () => {
  it('reads the visible text across formatted runs', () => {
    const paragraph = load('This Mutual Non-Disclosure Agreement');
    expect(paragraphText(paragraph, names)).toMatch(
      /^This Mutual Non-Disclosure Agreement \(the "Agreement"\) is entered/
    );
  });

  it('replaces text spanning runs, taking the formatting where it starts', () => {
    const paragraph = load('This Mutual Non-Disclosure Agreement');
    const text = paragraphText(paragraph, names);
    const start = text.indexOf('the "Agreement");');
    const from = text.indexOf('Agreement"');
    const to = text.indexOf(') is entered');
    expect(start).toBe(-1);
    replaceRange(paragraph, names, from, to, 'Contract"');
    expect(paragraphText(paragraph, names)).toContain(
      '(the "Contract") is entered'
    );
    expect(boldRuns(paragraph)).toEqual([
      '-This Mutual Non-Disclosure Agreement (the "',
      'BContract"',
      '-) is entered into as of October 1, 2026 (the "Effective Date") by and between Acme Corporation, a Delaware corporation ("Acme"), and Globex Industries LLC, a New York limited liability company ("Globex").',
    ]);
    expectUniqueIds(paragraph);
  });

  it('inserts, deletes and appends without disturbing other runs', () => {
    const paragraph = load('"Confidential Information" means');
    const original = paragraphText(paragraph, names);
    replaceRange(paragraph, names, 0, 0, 'A. ');
    expect(paragraphText(paragraph, names)).toBe(`A. ${original}`);
    replaceRange(paragraph, names, 0, 3, '');
    expect(paragraphText(paragraph, names)).toBe(original);
    const end = original.length;
    replaceRange(paragraph, names, end, end, ' Done.');
    expect(paragraphText(paragraph, names)).toBe(`${original} Done.`);
    // Still one run: the new text joined the existing text element.
    expect(serializeXml(paragraph).match(/<w:r /g)).toHaveLength(1);
  });

  it('writes tabs as tab elements and keeps spaces', () => {
    const paragraph = load('1. Definitions');
    const length = paragraphText(paragraph, names).length;
    replaceRange(paragraph, names, 0, length, ' 1.\tScope ');
    expect(paragraphText(paragraph, names)).toBe(' 1.\tScope ');
    const xml = serializeXml(paragraph);
    expect(xml).toContain('<w:tab ');
    expect(xml).toContain('xml:space="preserve"');
    expectUniqueIds(paragraph);
  });

  it('clears a paragraph and writes into an empty one', () => {
    const paragraph = load('1. Definitions');
    const length = paragraphText(paragraph, names).length;
    replaceRange(paragraph, names, 0, length, '');
    expect(paragraphText(paragraph, names)).toBe('');
    expect(serializeXml(paragraph)).not.toContain('<w:r ');
    replaceRange(paragraph, names, 0, 0, 'Scope');
    expect(paragraphText(paragraph, names)).toBe('Scope');
    expect(paragraphStyle(paragraph, names)).toBe('Heading1');
  });

  it('formats part of a run by splitting it', () => {
    const paragraph = load('"Confidential Information" means');
    formatRange(paragraph, names, 1, 25, { bold: true });
    expect(boldRuns(paragraph).slice(0, 3)).toEqual([
      '-"',
      'BConfidential Information',
      expect.stringMatching(/^-" means any non-public/),
    ]);
    expectUniqueIds(paragraph);
    // Turning it off writes an explicit off rather than inheriting the style.
    formatRange(paragraph, names, 1, 25, { bold: false });
    expect(boldRuns(paragraph)[1]).toBe('-Confidential Information');
    expect(serializeXml(paragraph)).toMatch(/<w:b [^>]*w:val="0"/);
  });

  it('keeps run properties in schema order', () => {
    const paragraph = load('This Mutual Non-Disclosure Agreement');
    const text = paragraphText(paragraph, names);
    const from = text.indexOf('Agreement"');
    formatRange(paragraph, names, from, from + 9, {
      underline: true,
      italic: true,
    });
    const rPr = /<w:rPr[^>]*>(.*?)<\/w:rPr>/.exec(serializeXml(paragraph))?.[1];
    const order = [...(rPr ?? '').matchAll(/<w:(\w+)/g)].map((m) => m[1]);
    expect(order).toEqual(['b', 'i', 'iCs', 'u']);
  });

  it('sets the style as the first paragraph property', () => {
    const paragraph = load('"Confidential Information" means');
    setParagraphStyle(paragraph, names, 'Quote');
    expect(serializeXml(paragraph)).toMatch(
      /^<w:p [^>]*><w:pPr p18:Unid="\w+"><w:pStyle w:val="Quote" p18:Unid="\w+" \/><\/w:pPr>/
    );
    setParagraphStyle(paragraph, names, 'Heading2');
    expect(paragraphStyle(paragraph, names)).toBe('Heading2');
  });

  it('creates paragraphs without copying a section break or revisions', () => {
    const pPr = parseElement(
      '<w:pPr p18:Unid="a"><w:pStyle w:val="ListNumber" p18:Unid="b"/><w:rPr p18:Unid="d"><w:ins w:id="1" w:author="Ann" p18:Unid="e"/><w:b p18:Unid="f"/></w:rPr><w:sectPr p18:Unid="c"/></w:pPr>'
    );
    const paragraph = createParagraph(names, 'Item', pPr);
    const xml = serializeXml(paragraph);
    expect(xml).toContain('w:val="ListNumber"');
    expect(xml).not.toContain('sectPr');
    // The mark's formatting is kept; Ann's tracked insertion is not.
    expect(xml).toContain('<w:b ');
    expect(xml).not.toContain('w:ins');
    expect(unids(xml)).not.toContain('b');
    expect(paragraphText(paragraph, names)).toBe('Item');
  });
});
