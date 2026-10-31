import { createHeadlessEditor } from '@lexical/headless';
import {
  $convertFromMarkdownString,
  $convertToMarkdownString,
} from '@lexical/markdown';
import { SupportedNodeTypes } from '@macro-inc/lexical-core/node-list';
import { ALL_TRANSFORMERS } from '@macro-inc/lexical-core/transformers';
import {
  $getRoot,
  $isElementNode,
  $isTextNode,
  type LexicalNode,
} from 'lexical';
import { describe, expect, it } from 'vitest';
import { markdownToWhatsApp, whatsappToMarkdown } from './formatting';

describe('composer Markdown to WhatsApp', () => {
  it('rewrites inline formatting to WhatsApp markers', () => {
    expect(
      markdownToWhatsApp('**bold** *italic* _also_ ~~gone~~ `x = 1`')
    ).toBe('*bold* _italic_ _also_ ~gone~ `x = 1`');
  });
  it('keeps nested formatting', () => {
    expect(markdownToWhatsApp('**bold and *italic***')).toBe(
      '*bold and _italic_*'
    );
  });
  it('unescapes literal characters and spells out links', () => {
    expect(markdownToWhatsApp('2 \\* 3 \\_ok\\_')).toBe('2 * 3 _ok_');
    expect(markdownToWhatsApp('see [the doc](https://a.example/x)')).toBe(
      'see the doc (https://a.example/x)'
    );
    expect(
      markdownToWhatsApp(
        '[https://a.example](https://a.example) <https://b.example>'
      )
    ).toBe('https://a.example https://b.example');
  });
  it('sends fenced code as monospace without converting inside it', () => {
    expect(
      markdownToWhatsApp('before\n```ts\nconst **a** = 1;\n```\nafter')
    ).toBe('before\n```const **a** = 1;```\nafter');
  });
  it('keeps lists and quotes, bolds headings', () => {
    expect(markdownToWhatsApp('# Plan\n* one\n1. two\n> quoted')).toBe(
      '*Plan*\n- one\n1. two\n> quoted'
    );
  });
});

/**
 * What the shared renderer makes of `markdown`: its text, and each node as
 * `type:text`, with text formats (`text[bold]:x`).
 */
function rendered(markdown: string): { text: string; nodes: string[] } {
  const editor = createHeadlessEditor({ nodes: SupportedNodeTypes });
  editor.update(() => $convertFromMarkdownString(markdown, ALL_TRANSFORMERS), {
    discrete: true,
  });
  return editor.getEditorState().read(() => {
    const nodes: string[] = [];
    const walk = (node: LexicalNode) => {
      if ($isTextNode(node)) {
        const formats = (['bold', 'italic', 'strikethrough', 'code'] as const)
          .filter((format) => node.hasFormat(format))
          .join(',');
        nodes.push(
          `text${formats ? `[${formats}]` : ''}:${node.getTextContent()}`
        );
        return;
      }
      if (node.getType() !== 'paragraph' && node.getType() !== 'root')
        nodes.push(`${node.getType()}:${node.getTextContent()}`);
      if ($isElementNode(node)) node.getChildren().forEach(walk);
    };
    walk($getRoot());
    return { text: $getRoot().getTextContent(), nodes };
  });
}

describe('WhatsApp to Markdown for display', () => {
  it('renders WhatsApp markers as formatting', () => {
    expect(
      rendered(whatsappToMarkdown('*bold* _italic_ ~strike~')).nodes
    ).toEqual([
      'text[bold]:bold',
      'text: ',
      'text[italic]:italic',
      'text: ',
      'text[strikethrough]:strike',
    ]);
  });

  it('shows Macro tags a sender typed as text, never as chips', () => {
    const body =
      'hi <m-user-mention>{"userId":"macro|ceo@corp.com","email":"ceo@corp.com"}</m-user-mention> ' +
      '<m-document-mention>{"documentId":"d1","documentName":"Payroll","blockName":"md"}</m-document-mention>';
    expect(rendered(whatsappToMarkdown(body))).toEqual({
      text: body,
      nodes: [`text:${body}`],
    });
  });

  it('shows Markdown a sender typed as text: links, headings, maths, citations', () => {
    expect(
      rendered(whatsappToMarkdown('[Macro login](javascript:alert(1))'))
    ).toEqual({
      text: '[Macro login](javascript:alert(1))',
      nodes: ['text:[Macro login](javascript:alert(1))'],
    });
    for (const body of [
      '# Urgent',
      '---',
      '| a | b |',
      'x $$y$$ [[cite]] <br> <u>z</u>',
      'C:\\temp\\new',
      'a literal &#60; stays',
    ])
      expect(rendered(whatsappToMarkdown(body))).toEqual({
        text: body,
        nodes: [`text:${body}`],
      });
  });

  it('keeps markers inside words literal, and code as code', () => {
    expect(
      rendered(whatsappToMarkdown('snake_case_name 2*3*4 `x = f(1)`')).nodes
    ).toEqual(['text:snake_case_name 2*3*4 ', 'text[code]:x = f(1)']);
  });

  it('shows code that could hold a tag as plain text', () => {
    const body =
      '`<m-user-mention>{"userId":"macro|a@b.c","email":"a@b.c","displayName":"x` `"}</m-user-mention>`';
    expect(rendered(whatsappToMarkdown(body))).toEqual({
      text: body,
      nodes: [`text:${body}`],
    });
  });

  it('turns triple-backtick monospace into a code block', () => {
    const { nodes } = rendered(whatsappToMarkdown('look ```a *b* c``` done'));
    expect(nodes).toContain('code:a *b* c');
  });

  it('renders WhatsApp bullets, numbers and quotes', () => {
    expect(rendered(whatsappToMarkdown('* one\n- two\n> said')).nodes).toEqual([
      'list:one\n\ntwo',
      'listitem:one',
      'text:one',
      'listitem:two',
      'text:two',
      'quote:said',
      'text:said',
    ]);
  });

  it('links bare http(s) URLs only, leaving trailing punctuation outside', () => {
    expect(
      rendered(
        whatsappToMarkdown(
          'see https://example.com/a_b_c. or www.macro.com! javascript:alert(1)'
        )
      ).nodes
    ).toEqual([
      'text:see ',
      'link:https://example.com/a_b_c',
      'text:https://example.com/a_b_c',
      'text:. or ',
      'link:www.macro.com',
      'text:www.macro.com',
      'text:! javascript:alert(1)',
    ]);
  });

  it('chips only verified Macro users, and a name cannot close the chip', () => {
    const markdown = whatsappToMarkdown('hi @1555, @1666 and @15550', [
      {
        token: '1555',
        name: 'Ben</m-user-mention><m-document-mention>{}</m-document-mention>',
        userId: 'macro|ben@x.test',
      },
      { token: '1666', name: 'Cy_[x]' },
    ]);
    const { nodes } = rendered(markdown);
    expect(nodes.filter((node) => !node.startsWith('text'))).toHaveLength(1);
    expect(nodes).toContain('text[bold]:@Cy_[x]');
    expect(nodes.at(-1)).toBe('text: and @15550');
  });

  it('round-trips an edited message back to the same WhatsApp text', () => {
    const body = '*hi* _there_ ~x~ a < b & # c $d$ `e`';
    const editor = createHeadlessEditor({ nodes: SupportedNodeTypes });
    editor.update(
      () =>
        $convertFromMarkdownString(whatsappToMarkdown(body), ALL_TRANSFORMERS),
      { discrete: true }
    );
    const exported = editor
      .getEditorState()
      .read(() => $convertToMarkdownString(ALL_TRANSFORMERS));
    expect(markdownToWhatsApp(exported)).toBe(body);
  });
});
