import { createHeadlessEditor } from '@lexical/headless';
import { $createListItemNode, $createListNode } from '@lexical/list';
import { $createMarkNode } from '@lexical/mark';
import { $createHeadingNode, $createQuoteNode } from '@lexical/rich-text';
import {
  $createLineBreakNode,
  $createParagraphNode,
  $createTabNode,
  $createTextNode,
  $getRoot,
} from 'lexical';
import { describe, expect, it } from 'vitest';
import { NodeReplacements, SupportedNodeTypes } from '../node-list';
import { $createCustomCodeNode } from '../nodes/CustomCodeNode';
import { $createEquationNode } from '../nodes/EquationNode';
import { $createHtmlRenderNode } from '../nodes/HtmlRenderNode';
import { $createImageNode } from '../nodes/ImageNode';
import { $createUserMentionNode } from '../nodes/UserMentionNode';
import { toXml } from '../transformers/xml';

function makeEditor() {
  return createHeadlessEditor({
    nodes: [...SupportedNodeTypes, ...NodeReplacements],
  });
}

function serialize(build: () => void): string {
  const editor = makeEditor();
  editor.update(
    () => {
      $getRoot().clear();
      build();
    },
    { discrete: true }
  );
  return toXml(editor.getEditorState().toJSON());
}

describe('xml serialization', () => {
  it('empty paragraph', () => {
    expect(
      serialize(() => {
        $getRoot().append($createParagraphNode());
      })
    ).toMatchInlineSnapshot(`
      "
      <doc>
        <p/>
      </doc>"
    `);
  });

  it('paragraph with plain text', () => {
    expect(
      serialize(() => {
        const p = $createParagraphNode();
        p.append($createTextNode('hello world'));
        $getRoot().append(p);
      })
    ).toMatchInlineSnapshot(`
      "
      <doc>
        <p>
          <t>hello world</t>
        </p>
      </doc>"
    `);
  });

  it('paragraph with bold and italic text', () => {
    expect(
      serialize(() => {
        const p = $createParagraphNode();
        p.append(
          $createTextNode('plain '),
          $createTextNode('bold').toggleFormat('bold'),
          $createTextNode(' '),
          $createTextNode('italic').toggleFormat('italic')
        );
        $getRoot().append(p);
      })
    ).toMatchInlineSnapshot(`
      "
      <doc>
        <p>
          <t>plain </t>
          <t bold="true">bold</t>
          <t> </t>
          <t italic="true">italic</t>
        </p>
      </doc>"
    `);
  });

  it('heading', () => {
    expect(
      serialize(() => {
        const h = $createHeadingNode('h1');
        h.append($createTextNode('My Title'));
        $getRoot().append(h);
      })
    ).toMatchInlineSnapshot(`
      "
      <doc>
        <h1>
          <t>My Title</t>
        </h1>
      </doc>"
    `);
  });

  it('bullet list', () => {
    expect(
      serialize(() => {
        const list = $createListNode('bullet');
        for (const text of ['one', 'two', 'three']) {
          const li = $createListItemNode();
          li.append($createTextNode(text));
          list.append(li);
        }
        $getRoot().append(list);
      })
    ).toMatchInlineSnapshot(`
      "
      <doc>
        <ul>
          <li>
            <t>one</t>
          </li>
          <li value="2">
            <t>two</t>
          </li>
          <li value="3">
            <t>three</t>
          </li>
        </ul>
      </doc>"
    `);
  });

  it('paragraph with line break', () => {
    expect(
      serialize(() => {
        const p = $createParagraphNode();
        p.append(
          $createTextNode('line one'),
          $createLineBreakNode(),
          $createTextNode('line two')
        );
        $getRoot().append(p);
      })
    ).toMatchInlineSnapshot(`
      "
      <doc>
        <p>
          <t>line one</t>
          <br/>
          <t>line two</t>
        </p>
      </doc>"
    `);
  });

  it('blockquote', () => {
    expect(
      serialize(() => {
        const q = $createQuoteNode();
        q.append($createTextNode('a wise thing'));
        $getRoot().append(q);
      })
    ).toMatchInlineSnapshot(`
      "
      <doc>
        <blockquote>
          <t>a wise thing</t>
        </blockquote>
      </doc>"
    `);
  });

  it('highlight (mark) drops the comment-thread ids', () => {
    expect(
      serialize(() => {
        const p = $createParagraphNode();
        const m = $createMarkNode(['thread-1']);
        m.append($createTextNode('important'));
        p.append(m);
        $getRoot().append(p);
      })
    ).toMatchInlineSnapshot(`
      "
      <doc>
        <p>
          <mark>
            <t>important</t>
          </mark>
        </p>
      </doc>"
    `);
  });

  it('code block flattens prism tokens back into raw source', () => {
    expect(
      serialize(() => {
        const code = $createCustomCodeNode('typescript');
        code.setCode('typescript', 'const x = 1 < 2;\nfoo(x);');
        $getRoot().append(code);
      })
    ).toMatchInlineSnapshot(`
      "
      <doc>
        <code language="typescript">const x = 1 &lt; 2;
      foo(x);</code>
      </doc>"
    `);
  });

  it('equation carries TeX as text content (special chars escaped)', () => {
    expect(
      serialize(() => {
        const p = $createParagraphNode();
        p.append($createEquationNode('a < b & c > "d"', true));
        $getRoot().append(p);
      })
    ).toMatchInlineSnapshot(`
      "
      <doc>
        <p>
          <equation inline="true">a &lt; b &amp; c &gt; &quot;d&quot;</equation>
        </p>
      </doc>"
    `);
  });

  it('image redacts a data: URI payload but keeps the prefix', () => {
    expect(
      serialize(() => {
        const p = $createParagraphNode();
        p.append(
          $createImageNode({
            srcType: 'url',
            url: 'data:image/png;base64,AAAA',
            alt: 'a duck',
          })
        );
        $getRoot().append(p);
      })
    ).toMatchInlineSnapshot(`
      "
      <doc>
        <p>
          <image alt="a duck" src="data:image/png;base64,..."/>
        </p>
      </doc>"
    `);
  });

  it('image keeps a real url as src', () => {
    expect(
      serialize(() => {
        const p = $createParagraphNode();
        p.append(
          $createImageNode({
            srcType: 'url',
            url: 'https://ex.com/duck.png',
            alt: 'a duck',
          })
        );
        $getRoot().append(p);
      })
    ).toMatchInlineSnapshot(`
      "
      <doc>
        <p>
          <image alt="a duck" src="https://ex.com/duck.png"/>
        </p>
      </doc>"
    `);
  });

  it('user mention keeps userId + email', () => {
    expect(
      serialize(() => {
        const p = $createParagraphNode();
        p.append($createUserMentionNode({ userId: 'u_1', email: 'a@b.com' }));
        $getRoot().append(p);
      })
    ).toMatchInlineSnapshot(`
      "
      <doc>
        <p>
          <user-mention userId="u_1" email="a@b.com"/>
        </p>
      </doc>"
    `);
  });

  it('tab serializes minimally', () => {
    expect(
      serialize(() => {
        const p = $createParagraphNode();
        p.append($createTextNode('a'), $createTabNode(), $createTextNode('b'));
        $getRoot().append(p);
      })
    ).toMatchInlineSnapshot(`
      "
      <doc>
        <p>
          <t>a</t>
          <tab/>
          <t>b</t>
        </p>
      </doc>"
    `);
  });

  it('html-render carries its html as escaped text content', () => {
    expect(
      serialize(() => {
        const p = $createParagraphNode();
        p.append($createHtmlRenderNode({ html: '<b>x</b>' }));
        $getRoot().append(p);
      })
    ).toMatchInlineSnapshot(`
      "
      <doc>
        <p>
          <html-render>&lt;b&gt;x&lt;/b&gt;</html-render>
        </p>
      </doc>"
    `);
  });
});
