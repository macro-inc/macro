import { createHeadlessEditor } from '@lexical/headless'
import { $createHeadingNode, $createQuoteNode } from '@lexical/rich-text'
import { $createListItemNode, $createListNode } from '@lexical/list'
import { $createHorizontalRuleNode } from '@lexical/react/LexicalHorizontalRuleNode'
import {
  $createLineBreakNode,
  $createParagraphNode,
  $createTextNode,
  $getRoot,
} from 'lexical'
import { describe, expect, it } from 'vitest'
import { SupportedNodeTypes, NodeReplacements } from '../node-list'
import { toXml } from '../transformers/xml'

function makeEditor() {
  return createHeadlessEditor({ nodes: [...SupportedNodeTypes, ...NodeReplacements] })
}

function serialize(build: () => void): string {
  const editor = makeEditor()
  editor.update(() => { $getRoot().clear(); build() }, { discrete: true })
  return toXml(editor.getEditorState().toJSON())
}

describe('xml serialization', () => {
  it('empty paragraph', () => {
    expect(serialize(() => {
      $getRoot().append($createParagraphNode())
    })).toMatchInlineSnapshot(`
      "
      <doc>
        <p/>
      </doc>"
    `)
  })

  it('paragraph with plain text', () => {
    expect(serialize(() => {
      const p = $createParagraphNode()
      p.append($createTextNode('hello world'))
      $getRoot().append(p)
    })).toMatchInlineSnapshot(`
      "
      <doc>
        <p>
          <t>hello world</t>
        </p>
      </doc>"
    `)
  })

  it('paragraph with bold and italic text', () => {
    expect(serialize(() => {
      const p = $createParagraphNode()
      p.append(
        $createTextNode('plain '),
        $createTextNode('bold').toggleFormat('bold'),
        $createTextNode(' '),
        $createTextNode('italic').toggleFormat('italic'),
      )
      $getRoot().append(p)
    })).toMatchInlineSnapshot(`
      "
      <doc>
        <p>
          <t>plain </t>
          <t bold="true">bold</t>
          <t> </t>
          <t italic="true">italic</t>
        </p>
      </doc>"
    `)
  })

  it('heading', () => {
    expect(serialize(() => {
      const h = $createHeadingNode('h1')
      h.append($createTextNode('My Title'))
      $getRoot().append(h)
    })).toMatchInlineSnapshot(`
      "
      <doc>
        <h1>
          <t>My Title</t>
        </h1>
      </doc>"
    `)
  })

  it('bullet list', () => {
    expect(serialize(() => {
      const list = $createListNode('bullet')
      for (const text of ['one', 'two', 'three']) {
        const li = $createListItemNode()
        li.append($createTextNode(text))
        list.append(li)
      }
      $getRoot().append(list)
    })).toMatchInlineSnapshot(`
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
    `)
  })

  it('paragraph with line break', () => {
    expect(serialize(() => {
      const p = $createParagraphNode()
      p.append(
        $createTextNode('line one'),
        $createLineBreakNode(),
        $createTextNode('line two'),
      )
      $getRoot().append(p)
    })).toMatchInlineSnapshot(`
      "
      <doc>
        <p>
          <t>line one</t>
          <br/>
          <t>line two</t>
        </p>
      </doc>"
    `)
  })

  it('blockquote', () => {
    expect(serialize(() => {
      const q = $createQuoteNode()
      q.append($createTextNode('a wise thing'))
      $getRoot().append(q)
    })).toMatchInlineSnapshot(`
      "
      <doc>
        <blockquote>
          <t>a wise thing</t>
        </blockquote>
      </doc>"
    `)
  })
})
