// @vitest-environment jsdom
import { expect, test } from 'vitest';
import { serializeClipboardDom } from './clipboard-dom';

test('DOM serialization preserves native attribute order, CSSOM bytes and escaped classes', () => {
  const data = serializeClipboardDom(
    {
      plain: 'a & b',
      lexical: 'unchanged',
      nodes: [
        {
          kind: 0,
          tag: 'li',
          text: '',
          attributes: [
            { name: 'value', value: '1', property: false, styles: [] },
            {
              name: 'class',
              value: '[&>ul]:my-0! font-bold',
              property: false,
              styles: [],
            },
            {
              property: false,
              name: 'style',
              value: 'white-space:pre-wrap',
              styles: [{ name: 'white-space', value: 'pre-wrap' }],
            },
          ],
          children: [
            { kind: 1, tag: '', text: 'a & b', attributes: [], children: [] },
          ],
        },
      ],
    },
    document
  );
  expect(data.plain).toBe('a & b');
  expect(data.lexical).toBe('unchanged');
  // jsdom leaves '>' literal in attributes; browser parity uses unchanged OFF goldens.
  expect(data.html).toBe(
    '<li value="1" class="[&amp;>ul]:my-0! font-bold" style="white-space: pre-wrap;">a &amp; b</li>'
  );
  expect(document.querySelector('li')).toBeNull();
});

test('unknown native node kinds fail without returning partial clipboard data', () => {
  expect(() =>
    serializeClipboardDom(
      {
        plain: '',
        lexical: '',
        nodes: [
          {
            kind: 255,
            tag: '',
            text: '',
            attributes: [],
            children: [],
          },
        ],
      },
      document
    )
  ).toThrow('Unknown native clipboard DOM node');
});

test('trusted raw fragments retain their parent parsing context', () => {
  const data = serializeClipboardDom(
    {
      plain: '',
      lexical: '',
      nodes: [
        {
          kind: 0,
          tag: 'script',
          text: '',
          attributes: [],
          children: [
            {
              kind: 3,
              tag: '',
              text: 'if (a < b && c > d) value = "&amp;";',
              attributes: [],
              children: [],
            },
          ],
        },
        {
          kind: 0,
          tag: 'textarea',
          text: '',
          attributes: [],
          children: [
            {
              kind: 3,
              tag: '',
              text: '&amp;<b>literal</b>',
              attributes: [],
              children: [],
            },
          ],
        },
        {
          kind: 0,
          tag: 'title',
          text: '',
          attributes: [],
          children: [
            {
              kind: 3,
              tag: '',
              text: 'a &amp; b',
              attributes: [],
              children: [],
            },
          ],
        },
      ],
    },
    document
  );
  expect(data.html).toBe(
    '<script>if (a < b && c > d) value = "&amp;";</script><textarea>&amp;&lt;b&gt;literal&lt;/b&gt;</textarea><title>a &amp; b</title>'
  );
});

test('foreign export fragments retain namespaces and browser integration points', () => {
  const data = serializeClipboardDom(
    {
      plain: '',
      lexical: '',
      nodes: [
        {
          kind: 0,
          tag: 'svg',
          text: '',
          attributes: [
            {
              name: 'viewbox',
              value: '0 0 10 10',
              property: false,
              styles: [],
            },
            {
              name: 'preserveaspectratio',
              value: 'xMidYMid',
              property: false,
              styles: [],
            },
          ],
          children: [
            {
              kind: 0,
              tag: 'lineargradient',
              text: '',
              attributes: [],
              children: [],
            },
            {
              kind: 3,
              tag: '',
              text: '<circle cx="1" />',
              attributes: [],
              children: [],
            },
            {
              kind: 0,
              tag: 'foreignobject',
              text: '',
              attributes: [],
              children: [
                {
                  kind: 0,
                  tag: 'div',
                  text: '',
                  attributes: [],
                  children: [
                    {
                      kind: 1,
                      tag: '',
                      text: 'html',
                      attributes: [],
                      children: [],
                    },
                  ],
                },
              ],
            },
          ],
        },
        {
          kind: 0,
          tag: 'math',
          text: '',
          attributes: [],
          children: [
            {
              kind: 0,
              tag: 'mi',
              text: '',
              attributes: [],
              children: [
                {
                  kind: 0,
                  tag: 'span',
                  text: '',
                  attributes: [],
                  children: [
                    {
                      kind: 1,
                      tag: '',
                      text: 'x',
                      attributes: [],
                      children: [],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
    document
  );
  expect(data.html).toBe(
    '<svg viewBox="0 0 10 10" preserveAspectRatio="xMidYMid"><linearGradient></linearGradient><circle cx="1"></circle><foreignObject><div>html</div></foreignObject></svg><math><mi><span>x</span></mi></math>'
  );
});

test('native template children serialize from the template content fragment', () => {
  const data = serializeClipboardDom(
    {
      plain: '',
      lexical: '',
      nodes: [
        {
          kind: 0,
          tag: 'template',
          text: '',
          attributes: [
            {
              name: 'shadowrootmode',
              value: 'open',
              property: false,
              styles: [],
            },
          ],
          children: [
            {
              kind: 0,
              tag: 'span',
              text: '',
              attributes: [],
              children: [
                {
                  kind: 1,
                  tag: '',
                  text: 'outer',
                  attributes: [],
                  children: [],
                },
              ],
            },
            {
              kind: 0,
              tag: 'template',
              text: '',
              attributes: [],
              children: [
                {
                  kind: 3,
                  tag: '',
                  text: '<b>inner &amp; safe</b>',
                  attributes: [],
                  children: [],
                },
              ],
            },
          ],
        },
      ],
    },
    document
  );
  expect(data.html).toBe(
    '<template shadowrootmode="open"><span>outer</span><template><b>inner &amp; safe</b></template></template>'
  );
});

test('exporting stored custom markup does not construct live application elements', () => {
  let constructed = 0;
  customElements.define(
    'clipboard-export-probe',
    class extends HTMLElement {
      constructor() {
        super();
        constructed++;
      }
    }
  );
  const data = serializeClipboardDom(
    {
      plain: '',
      lexical: '',
      nodes: [
        {
          kind: 0,
          tag: 'clipboard-export-probe',
          text: '',
          attributes: [],
          children: [
            { kind: 1, tag: '', text: 'stored', attributes: [], children: [] },
          ],
        },
      ],
    },
    document
  );
  expect(data.html).toBe(
    '<clipboard-export-probe>stored</clipboard-export-probe>'
  );
  expect(constructed).toBe(0);
});

test('ordered DOM properties use browser setters while parser attributes stay literal', () => {
  const data = serializeClipboardDom(
    {
      plain: '',
      lexical: '',
      nodes: [
        {
          kind: 0,
          tag: 'li',
          text: '',
          attributes: [
            { name: 'value', value: '7.9', styles: [], property: true },
            { name: 'class', value: 'item', styles: [], property: false },
          ],
          children: [],
        },
        {
          kind: 0,
          tag: 'li',
          text: '',
          attributes: [
            { name: 'role', value: 'checkbox', styles: [], property: false },
            { name: 'value', value: '7', styles: [], property: true },
            { name: 'class', value: 'item', styles: [], property: false },
            { name: 'value', value: '3', styles: [], property: false },
          ],
          children: [],
        },
        {
          kind: 0,
          tag: 'li',
          text: '',
          attributes: [
            { name: 'value', value: '007', styles: [], property: false },
          ],
          children: [],
        },
      ],
    },
    document
  );
  expect(data.html).toBe(
    '<li value="7" class="item"></li><li role="checkbox" value="3" class="item"></li><li value="007"></li>'
  );
});
