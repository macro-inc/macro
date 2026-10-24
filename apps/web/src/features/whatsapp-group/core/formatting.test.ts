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

describe('WhatsApp to Markdown for display', () => {
  it('rewrites WhatsApp markers to Markdown', () => {
    expect(whatsappToMarkdown('*bold* _italic_ ~strike~')).toBe(
      '**bold** *italic* ~~strike~~'
    );
  });
  it('leaves markers inside words and code alone', () => {
    expect(whatsappToMarkdown('snake_case_name 2*3*4 `*not*`')).toBe(
      'snake_case_name 2*3*4 `*not*`'
    );
  });
  it('turns triple-backtick monospace into a code block', () => {
    expect(whatsappToMarkdown('look ```a *b* c``` done')).toBe(
      'look \n```\na *b* c\n```\n done'
    );
  });
  it('links bare URLs, leaving punctuation and code alone', () => {
    expect(
      whatsappToMarkdown('see https://example.com/a_b_c. or www.macro.com!')
    ).toBe(
      'see [https://example.com/a_b_c](https://example.com/a_b_c). or [www.macro.com](https://www.macro.com)!'
    );
    expect(whatsappToMarkdown('`https://x.com`')).toBe('`https://x.com`');
  });
  it('sends a linked URL back as the bare URL', () => {
    expect(
      markdownToWhatsApp(whatsappToMarkdown('go to https://example.com now'))
    ).toBe('go to https://example.com now');
  });
  it('round-trips what the composer sends', () => {
    expect(whatsappToMarkdown(markdownToWhatsApp('**hi** *there* ~~x~~'))).toBe(
      '**hi** *there* ~~x~~'
    );
  });
});
