import { describe, expect, it } from 'vitest';
import { type SerializedEditorState, toXml } from '../transformers/xml';

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

describe('xml', () => {
    it('serializes an empty paragraph as self-closing', () => {
      const state = root([paragraph([], 'p1')]);
      const xml = toXml(state);
      expect(xml).toContain('<p id="p1"/>');
    });

    it('serializes table colWidths', () => {
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
      expect(toXml(state)).toContain('colWidths="120,120"');
    });

    it('serializes a horizontal rule as self-closing', () => {
      const state = root([
        { type: 'horizontalrule', version: 1, $: { id: 'hr1' } },
      ]);
      expect(toXml(state)).toContain('<hr id="hr1"/>');
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
    });
});
