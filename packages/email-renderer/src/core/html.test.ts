import { describe, expect, it } from 'vitest';
import {
  parseEmailContent,
  prepareEmailBody,
  sanitizeEmailHtml,
  trimTrailingHtml,
} from './html';

describe('prepareEmailBody in Node, without a DOM', () => {
  it('normalizes frameset documents to an empty inert body', () => {
    const html = '<frameset><frame src="https://example.com"></frameset>';
    expect(prepareEmailBody({ html })).toMatchObject({
      html: '',
      hasTable: false,
    });
    expect(parseEmailContent(html)).toEqual({
      mainContent: '',
      signature: null,
      hasTable: false,
    });
    expect(sanitizeEmailHtml(html)).toBe('<head></head><body></body>');
  });
  it('is deterministic and leaves inputs unchanged', () => {
    const input = Object.freeze({
      html: '<p>Hello<br><br></p><div class="gmail_signature">Signature</div>',
    });
    const first = prepareEmailBody(input);
    expect(first).toEqual(prepareEmailBody(input));
    expect(JSON.parse(JSON.stringify(first))).toEqual(first);
    expect(first.html).toBe('<p>Hello</p>');
    expect(first.hasHiddenContent).toBe(true);
    expect(typeof globalThis).toBe('object');
    expect('document' in globalThis).toBe(false);
  });
  it('falls back to actual content while replyless HTML is unavailable', () => {
    expect(prepareEmailBody({ html: '<p>New message</p>' }).html).toBe(
      '<p>New message</p>'
    );
    expect(
      prepareEmailBody({ html: '<p>New message</p>', replylessHtml: '' }).html
    ).toBe('<p>New message</p>');
  });
  it('removes recognized quotes on fallback and restores the full body on request', () => {
    const input = {
      html: '<p>New</p><div class="macro_quote">Old</div><div class="macro-email-signature">Me</div>',
    };
    expect(prepareEmailBody(input)).toMatchObject({
      html: '<p>New</p>',
      hasHiddenContent: true,
    });
    expect(prepareEmailBody(input, { showQuotedContent: true }).html).toBe(
      input.html
    );
  });
  it('uses backend replyless content and detects differences with equal lengths', () => {
    const input = { html: '<p>Old</p>', replylessHtml: '<p>New</p>' };
    expect(prepareEmailBody(input)).toMatchObject({
      html: '<p>New</p>',
      hasHiddenContent: true,
    });
  });
  it('renders plaintext literally, including Markdown syntax and angle brackets', () => {
    const body = prepareEmailBody({
      text: '**Hello**\n<img src=x onerror=alert(1)> & goodbye',
    });
    expect(body.kind).toBe('text');
    expect(body.html).toContain(
      '**Hello**\n&lt;img src=x onerror=alert(1)&gt; &amp; goodbye'
    );
    expect(body.hasHiddenContent).toBe(false);
  });
  it('handles malformed HTML using the HTML parser and preserves tables', () => {
    expect(prepareEmailBody({ html: '<table><tr><td>A<td>B' })).toMatchObject({
      html: '<table><tbody><tr><td>A</td><td>B</td></tr></tbody></table>',
      hasTable: true,
    });
  });
  it('retains document styles and signatures according to explicit options', () => {
    const result = parseEmailContent(
      '<head><style>p { color: red }</style></head><body><p>A<br></p><span class="gmail_signature_prefix">--</span><div class="gmail_signature">Me</div></body>'
    );
    expect(result.mainContent).toBe('<style>p{color:red}</style>\n<p>A</p>');
    expect(result.signature).toBe('<div class="gmail_signature">Me</div>');
  });
  it.each(['<p>A<br><br></p>  ', '<div><p>A</p><div><br></div></div>'])(
    'trims trailing breaks and empty wrappers: %s',
    (html) => {
      expect(trimTrailingHtml(html)).not.toContain('<br>');
      expect(trimTrailingHtml(html)).toContain('A');
    }
  );
  it('keeps trailing images and meaningful text', () => {
    expect(trimTrailingHtml('<p>A</p><img src="cid:a">')).toContain('<img');
    expect(trimTrailingHtml('<p>A<br>B</p>')).toContain('A<br>B');
  });
});

describe('content and resource policy', () => {
  it('preserves spaces in mailto parameters and HTTP image paths', () => {
    const result = sanitizeEmailHtml(
      '<a href="mailto:a@example.com?subject=Hello World&amp;body=See you soon">Mail</a><img src="https://example.com/my image.png"><p style="background:url(\'https://example.com/my image.png\')">X</p>'
    );
    expect(result).toContain('subject=Hello World&amp;body=See you soon');
    expect(result).toContain('src="https://example.com/my image.png"');
    expect(result).not.toContain('myimage.png');
    const proxied = prepareEmailBody(
      { html: '<img src="https://example.com/my image.png">' },
      { images: { remote: 'allow', proxyUrl: 'https://proxy.test' } }
    );
    expect(proxied.html).toContain('my%20image.png');
  });
  it('recognizes CSS escapes in host selectors and image-set functions', () => {
    const result = sanitizeEmailHtml(
      '<style>:h\\6fst{color:red}p{background:i\\6d age-set("https://evil.test/a" 1x)}</style>'
    );
    expect(result).not.toContain('color:red');
    expect(result).not.toContain('evil.test');
  });
  it('rejects escaped URL functions the CSS parser cannot normalize as URL nodes', () => {
    const html =
      '<style>p{background:u\\72l("https://evil.test/a")}</style><p style="background:u\\72l(\'https://evil.test/b\')">Text</p>';
    expect(
      prepareEmailBody({ html }, { images: { remote: 'block' } }).html
    ).not.toContain('evil.test');
    expect(
      prepareEmailBody(
        { html },
        { images: { remote: 'allow', proxyUrl: 'https://proxy.test' } }
      ).html
    ).not.toContain('evil.test');
  });
  it('normalizes source schemes for CID and native HTTPS adapters', () => {
    expect(
      sanitizeEmailHtml('<img src="CID:part"><img src="HTTPS://example.com/a">')
    ).toContain('src="cid:part"');
    expect(sanitizeEmailHtml('<img src="HTTPS://example.com/a">')).toContain(
      'src="https://example.com/a"'
    );
  });
  it.each([
    '<img src="https://example.com/x" onerror="alert(1)">',
    '<script>alert(1)</script><iframe src="https://example.com"></iframe>',
    '<svg><a href="javascript:alert(1)">x</a></svg><math><mi>x</mi></math>',
    '<a href="java&#10;script:alert(1)" ping="https://example.com">x</a>',
    '<form action="https://example.com"><input autofocus><button>send</button></form>',
    '<template><img src=x onerror="alert(1)"></template>',
  ])('removes active markup before insertion: %s', (html) => {
    const result = sanitizeEmailHtml(html);
    expect(result).not.toMatch(
      /onerror|alert\(|<script|<iframe|<svg|<math|<form|<input|<template|ping=/
    );
  });
  it('allows safe links but forbids data navigation and origin-dependent paths', () => {
    const result = sanitizeEmailHtml(
      '<a href="mailto:a@example.com">mail</a><a href="https://example.com">web</a><a href="data:image/png;base64,AAAA">data</a><a href="/app/delete">relative</a>'
    );
    expect(result).toContain('href="mailto:a@example.com"');
    expect(result).toContain('href="https://example.com"');
    expect(result).not.toContain('href="data:');
    expect(result).not.toContain('href="/app');
  });
  it('blocks every automatic remote resource path, including styles and source sets', () => {
    const result = prepareEmailBody(
      {
        html: '<style>@import "https://evil.test/a";@font-face{font-family:x;src:url(https://evil.test/font)}p{background:url(https://evil.test/a)}b{background:image-set("https://evil.test/b" 1x)}</style><p style="background: url(https://evil.test/c)">Text</p><img src="https://evil.test/d" srcset="https://evil.test/e 2x"><table background="https://evil.test/f"><tr><td>x</td></tr></table>',
      },
      { images: { remote: 'block' } }
    );
    expect(result.html).not.toContain('evil.test');
    expect(result.html).not.toContain('srcset');
  });
  it('proxies img sources while retaining direct background URLs for native compatibility', () => {
    const result = prepareEmailBody(
      {
        html: '<style>p{background:url(https://example.com/rule)}</style><img src="https://example.com/a"><p style="background:url(https://example.com/b)">X</p><table background="https://example.com/table"><tr><td>X</td></tr></table>',
      },
      { images: { remote: 'allow', proxyUrl: 'https://proxy.test/image' } }
    );
    expect(result.html).toContain(
      'https://proxy.test/image?url=https%3A%2F%2Fexample.com%2Fa'
    );
    expect(result.html).toContain('url(https://example.com/b)');
    expect(result.html).toContain('url(https://example.com/rule)');
    expect(result.html).toContain('background="https://example.com/table"');
    expect(result.html.match(/proxy\.test/g)).toHaveLength(1);
  });
  it('keeps CID and raster data images, excluding SVG data images', () => {
    const result = sanitizeEmailHtml(
      '<img src="cid:part"><img src="data:image/png;base64,AAAA"><img src="data:image/svg+xml;base64,AAAA">'
    );
    expect(result).toContain('src="cid:part"');
    expect(result).toContain('src="data:image/png;base64,AAAA"');
    expect(result).not.toContain('svg+xml');
  });
  it('strips nested dark mode rules, host selectors and unsafe CSS escapes', () => {
    const result = sanitizeEmailHtml(
      '<style>@media screen{@media(prefers-color-scheme:dark){p{color:white}}p{color:red}}:host{position:fixed}p{background:url(javascript:alert)}p{color:blue}</style>'
    );
    expect(result).not.toMatch(/prefers-color-scheme|:host|javascript/);
    expect(result).toContain('color:red');
    expect(result).toContain('color:blue');
  });
  it('never allows CSS strings to break out of a style element', () => {
    const result = sanitizeEmailHtml(
      '<style>p::after{content:"< /style>"}</style>'
    );
    expect(result).not.toContain('content:"<');
  });
});
