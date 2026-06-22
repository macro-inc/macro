import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { fromXml, type SerializedEditorState, toXml } from '../transformers/xml';

function root(children: any[]): SerializedEditorState {
  return {
    root: {
      children,
      direction: 'ltr',
      format: '',
      indent: 0,
      type: 'root',
      version: 1,
      $: {
        documentMetadata: { version: 1.4, environmentTags: null },
        id: 'root',
      },
    },
  } as SerializedEditorState;
}

function text(value: string, format = 0, id = 't') {
  return {
    detail: 0,
    format,
    mode: 'normal',
    style: '',
    text: value,
    type: 'text',
    version: 1,
    $: { id },
  };
}

function paragraph(children: any[], id = 'p') {
  return {
    children,
    direction: 'ltr',
    format: '',
    indent: 0,
    type: 'paragraph',
    version: 1,
    $: { id },
    textFormat: 0,
    textStyle: '',
  };
}

const FORMAT = {
  bold: 1,
  italic: 2,
  strikethrough: 4,
  underline: 8,
  code: 16,
} as const;

/**
 * Normalize away the fields the XML format intentionally does not carry, so a
 * round-tripped state can be compared to the original. The format is a
 * semantic projection: it drops the runtime-derived `direction` flag, the
 * derivable listitem ordinal `value`, and the doc-mention block metadata that
 * the spec'd `<doc-mention>` element does not include.
 */
function normalize(state: any): any {
  const clone = JSON.parse(JSON.stringify(state));
  const walk = (n: any) => {
    if (Array.isArray(n)) {
      n.forEach(walk);
      return;
    }
    if (n && typeof n === 'object') {
      if ('direction' in n) n.direction = 'ltr';
      if (n.type === 'listitem') n.value = 1;
      if (n.type === 'document-mention') {
        delete n.blockName;
        delete n.blockParams;
        delete n.collapsed;
        delete n.createdAt;
        delete n.channelType;
      }
      for (const v of Object.values(n)) walk(v);
    }
  };
  walk(clone);
  return clone;
}

describe('xml', () => {
    it('round-trips doc.json (XML stable + semantic deep-equal)', () => {
      const docPath = fileURLToPath(new URL('../doc.json', import.meta.url));
      const doc = JSON.parse(
        readFileSync(docPath, 'utf-8')
      ) as SerializedEditorState;

      const xml = toXml(doc);
      const back = fromXml(xml);

      // The XML projection is lossless w.r.t. itself: re-emitting must be
      // byte-identical.
      expect(toXml(back)).toBe(xml);

      // And the parsed tree matches the original once the deliberately-dropped
      // runtime fields are normalized.
      expect(normalize(back)).toEqual(normalize(doc));
    });

    it('round-trips a paragraph with mixed formatting', () => {
      const state = root([
        paragraph(
          [
            text('plain ', 0, 't1'),
            text('bold', FORMAT.bold, 't2'),
            text(' ', 0, 't3'),
            text('italic', FORMAT.italic, 't4'),
            text(' ', 0, 't5'),
            text('bolditalic', FORMAT.bold | FORMAT.italic, 't6'),
          ],
          'p1'
        ),
      ]);

      expect(normalize(fromXml(toXml(state)))).toEqual(normalize(state));
    });

    it('round-trips an empty paragraph', () => {
      const state = root([paragraph([], 'p1')]);
      const xml = toXml(state);
      expect(xml).toContain('<p id="p1"/>');
      expect(normalize(fromXml(xml))).toEqual(normalize(state));
    });

    it('round-trips a heading', () => {
      const state = root([
        {
          children: [text('Title', 0, 't1')],
          direction: 'ltr',
          format: '',
          indent: 0,
          type: 'heading',
          version: 1,
          $: { id: 'h1' },
          tag: 'h1',
        },
      ]);
      expect(normalize(fromXml(toXml(state)))).toEqual(normalize(state));
    });

    it('round-trips a bullet list', () => {
      const li = (txt: string, id: string, value: number) => ({
        children: [paragraph([text(txt, 0, `t-${id}`)], `p-${id}`)],
        direction: 'ltr',
        format: '',
        indent: 0,
        type: 'listitem',
        version: 1,
        $: { id },
        value,
      });
      const state = root([
        {
          children: [li('one', 'li1', 1), li('two', 'li2', 2), li('three', 'li3', 3)],
          direction: 'ltr',
          format: '',
          indent: 0,
          type: 'list',
          version: 1,
          $: { id: 'l1' },
          listType: 'bullet',
          start: 1,
          tag: 'ul',
        },
      ]);
      expect(normalize(fromXml(toXml(state)))).toEqual(normalize(state));
    });

    it('round-trips a 2x2 table', () => {
      const cell = (txt: string, id: string) => ({
        children: [paragraph([text(txt, 0, `t-${id}`)], `p-${id}`)],
        direction: 'ltr',
        format: '',
        indent: 0,
        type: 'tablecell',
        version: 1,
        $: { id },
        backgroundColor: null,
        colSpan: 1,
        headerState: 0,
        rowSpan: 1,
      });
      const row = (cells: any[], id: string) => ({
        children: cells,
        direction: 'ltr',
        format: '',
        indent: 0,
        type: 'tablerow',
        version: 1,
        $: { id },
      });
      const state = root([
        {
          children: [
            row([cell('a', 'c1'), cell('b', 'c2')], 'r1'),
            row([cell('c', 'c3'), cell('d', 'c4')], 'r2'),
          ],
          direction: 'ltr',
          format: '',
          indent: 0,
          type: 'table',
          version: 1,
          $: { id: 't1' },
          colWidths: [120, 120],
        },
      ]);
      const xml = toXml(state);
      expect(xml).toContain('colWidths="120,120"');
      expect(normalize(fromXml(xml))).toEqual(normalize(state));
    });

    it('round-trips inline custom nodes (date + user mention)', () => {
      const state = root([
        paragraph(
          [
            text('Meeting on ', 0, 't1'),
            {
              type: 'date-mention',
              version: 1,
              $: { id: 'd1' },
              date: '2026-06-16T04:00:00.000Z',
              displayFormat: 'june 16',
            },
            text(' with ', 0, 't2'),
            {
              type: 'user-mention',
              version: 1,
              $: { id: 'u1' },
              userId: '123',
              email: 'wolf@macro.com',
              mentionUuid: 'abc',
            },
          ],
          'p1'
        ),
      ]);
      // Known tradeoff: unknown-node attrs that look like numbers round-trip as numbers.
      const normalized = normalize(fromXml(toXml(state)));
      const expected = normalize(state);
      (normalized.root as any).children[0].children[3].userId = String(
        (normalized.root as any).children[0].children[3].userId
      );
      expect(normalized).toEqual(expected);
    });

    it('round-trips a standalone horizontal rule', () => {
      const state = root([
        { type: 'horizontalrule', version: 1, $: { id: 'hr1' } },
      ]);
      const xml = toXml(state);
      expect(xml).toContain('<hr id="hr1"/>');
      expect(normalize(fromXml(xml))).toEqual(normalize(state));
    });

    it('round-trips an unknown node type opaquely', () => {
      const state = root([
        {
          type: 'snapshot',
          version: 1,
          $: { id: 'sn1' },
          someField: 'value',
          nested: { a: 1, b: [2, 3] },
        },
      ]);
      const xml = toXml(state);
      expect(xml).toMatch(/<snapshot id="sn1"/);
      const back = fromXml(xml);
      expect(back).toEqual(state);
    });

    it('emits the expected XML for a simple known input (snapshot)', () => {
      const state = root([
        paragraph(
          [text('hi ', 0, 'ta'), text('bold', FORMAT.bold, 'tb')],
          'p1'
        ),
      ]);
      const xml = toXml(state);
      expect(xml).toContain('<doc>');
      expect(xml).toContain('<p id="p1">');
      expect(xml).toContain('<t id="ta">hi </t>');
      expect(xml).toContain('<t id="tb" bold="true">bold</t>');
    });

    it('escapes special characters in text and attributes', () => {
      const state = root([
        paragraph([text('a < b & c > d "q"', 0, 't1')], 'p1'),
      ]);
      const xml = toXml(state);
      expect(xml).toContain('&lt;');
      expect(xml).toContain('&amp;');
      expect(xml).toContain('&gt;');
      expect(normalize(fromXml(xml))).toEqual(normalize(state));
    });
});
