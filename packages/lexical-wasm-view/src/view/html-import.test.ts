// @vitest-environment jsdom

import { CodeHighlightNode, CodeNode } from '@lexical/code';
import { createHeadlessEditor } from '@lexical/headless';
import { $generateNodesFromDOM } from '@lexical/html';
import { AutoLinkNode, LinkNode } from '@lexical/link';
import { ListItemNode, ListNode } from '@lexical/list';
import { MarkNode } from '@lexical/mark';
import { HeadingNode, QuoteNode } from '@lexical/rich-text';
import { TableCellNode, TableNode, TableRowNode } from '@lexical/table';
import {
  $isElementNode,
  type LexicalNode,
  type SerializedLexicalNode,
} from 'lexical';
import { expect, test } from 'vitest';
import { importHTML } from './html-import';

const baseCases = [
  'plain',
  '<p>Hello</p>',
  '<div>Hello</div>',
  '<br>',
  '<p><br></p>',
  '<p>Hello<br>world</p>',
  '<p>  white   space\nnext </p>',
  '<p>a&nbsp;b</p>',
  '<b>bold</b>',
  '<strong>bold</strong>',
  '<i>italic</i>',
  '<em>italic</em>',
  '<u>under</u>',
  '<s>strike</s>',
  '<del>strike</del>',
  '<strike>strike</strike>',
  '<sub>sub</sub>',
  '<sup>sup</sup>',
  '<code>inline</code>',
  '<mark>highlight</mark>',
  '<b><i>both</i></b>',
  '<span style="font-weight: 700">bold</span>',
  '<span style="font-style: italic">italic</span>',
  '<span style="text-decoration: underline line-through">both</span>',
  '<blockquote>quote</blockquote>',
  '<h1>Title</h1>',
  '<h2>Title</h2>',
  '<h3>Title</h3>',
  '<h4>Title</h4>',
  '<h5>Title</h5>',
  '<h6>Title</h6>',
  '<ul><li>one</li><li>two</li></ul>',
  '<ol start="3"><li>one</li><li value="8">two</li></ol>',
  '<ul><li>one<ul><li>nested</li></ul></li></ul>',
  '<a href="https://example.com">link</a>',
  '<a href="/relative" title="title" target="_blank" rel="noopener">link</a>',
  '<pre>const n = 1;\nnext</pre>',
  '<pre><code>const n = 1;</code></pre>',
  '<table><tr><th>head</th><td>cell</td></tr></table>',
  '<table><tr><td colspan="2" rowspan="2"><p>cell</p></td></tr></table>',
  '<script>ignored</script><p>safe</p>',
];
interface SerializedDraft extends SerializedLexicalNode {
  children?: SerializedDraft[];
}
function serialize(node: LexicalNode): SerializedDraft {
  const json = node.exportJSON();
  if ($isElementNode(node))
    return { ...json, children: node.getChildren().map(serialize) };
  return json;
}
const cases = [
  ...baseCases,
  ...baseCases.map((html) => `<div>${html}</div>`),
  ...baseCases.map((html) => `<section>${html}</section>`),
  '<p></p>',
  '<div></div>',
  '<section></section>',
  '<p>a<br></p>',
  '<p>a<br><br></p>',
  '<p>a<span> b </span>c</p>',
  '<p>a <b> b </b> c</p>',
  '<p>😀 café עברית</p>',
  '<b style="font-weight: normal">plain</b>',
  '<b>bold <b style="font-weight: normal">normal</b></b>',
  '<span style="white-space:pre">a\tb\nc</span>',
  '<ul __lexicallisttype="check"><li aria-checked="true">checked</li><li aria-checked="false">unchecked</li></ul>',
  '<table><tr><td></td><td><br></td></tr></table>',
  '<table><tr><th scope="row">row</th><th scope="col">col</th></tr><tr><th>first</th><th>last</th></tr></table>',
  '<table><tr style="height: 32px"><td style="width: 80px; background-color: red; vertical-align: middle; color: blue; font-weight: bold">cell</td></tr></table>',
  '<p dir="rtl" style="text-align: right">עברית</p>',
  '<a>no href</a>',
  '<a id="chapter"></a>',
  '<a href=""></a>',
  '<a href="https://example.com"></a>',
  '<a id="chapter"> \n<!-- anchor --> </a>',
  '<a id="chapter"><span></span></a>',
  '<code>multi\nline</code>',
  '<ol start="0"><li>zero</li></ol>',
  '<ol start="-4"><li>negative</li></ol>',
  '<ol start="2.9"><li>fractional</li></ol>',
  '<ol start="7tail"><li>prefix</li></ol>',
  '<ol start=""><li>empty</li></ol>',
  '<ol start="bad"><li>invalid</li></ol>',
  '<ul start="9"><li>unordered start</li></ul>',
  '<ul style="text-align:right" dir="rtl"><li>list alignment</li></ul>',
  '<ul><li><p style="text-align:right">paragraph alignment</p></li></ul>',
  '<ul><li style="text-align:left"><p style="text-align:right">item alignment wins</p></li></ul>',
  '<ul class="contains-task-list"><li class="task-list-item"><input type="checkbox" checked>checked</li></ul>',
  '<ul class="contains-task-list"><li><input type="checkbox" checked>ordinary item</li></ul>',
  '<ul class="contains-task-list"><li aria-checked="false"><span><input type="checkbox" checked></span>nested input</li></ul>',
  '<ul class="contains-task-list"><li class="task-list-item" aria-checked="true"><input type="text">wrong input</li></ul>',
  '<ul class="contains-task-list"><li class="task-list-item"><input type="Checkbox" checked>mixed case</li></ul>',
  '<ul data-is-checklist="1"><li class="joplin-checkbox"><span class="checkbox-wrapper"><input type="checkbox" checked></span>checked</li></ul>',
  '<ul data-is-checklist="1"><li class="joplin-checkbox" aria-checked="false"><span class="checkbox-wrapper"><span></span><input type="checkbox" checked></span>not first</li></ul>',
  '<pre dir="rtl" style="text-align:right" data-highlight-language="rust">code direction</pre>',
  '<div style="font-family:monospace"><div>first</div><div>second</div></div>',
  '<table class="js-file-line-container"><tr><td data-line-number="1"></td><td class="js-file-line">first</td></tr><tr><td data-line-number="2"></td><td class="js-file-line">second</td></tr></table>',
];
for (const html of cases)
  test(`HTML drafts match pinned upstream: ${html}`, () => {
    const editor = createHeadlessEditor({
      namespace: 'html-oracle',
      nodes: [
        HeadingNode,
        QuoteNode,
        ListNode,
        ListItemNode,
        LinkNode,
        AutoLinkNode,
        TableNode,
        TableRowNode,
        TableCellNode,
        CodeNode,
        CodeHighlightNode,
        MarkNode,
      ],
      onError: (error) => {
        throw error;
      },
    });
    let expected: unknown;
    editor.update(
      () => {
        expected = JSON.parse(
          JSON.stringify(
            $generateNodesFromDOM(
              editor,
              new DOMParser().parseFromString(html, 'text/html')
            ).map(serialize)
          )
        );
      },
      { discrete: true }
    );
    expect(importHTML(html, document).map((json) => JSON.parse(json))).toEqual(
      expected
    );
  });
