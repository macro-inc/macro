import { describe, expect, it } from 'vitest';
import { prepareEmailBody, sanitizeEmailHtml } from './html';

describe('prepareEmailBody in Node, without a DOM', () => {
  it('preserves inert editor metadata in outgoing HTML while stripping it from the reader', () => {
    const html =
      '<p data-lexical-indent="1"><a data-document-mention="true" data-document-id="document-1" data-document-name="Spec" data-block-name="md" href="https://example.com/spec" onclick="alert(1)">Spec</a><img data-scale="0.5" src="cid:part" onerror="alert(1)"></p>';
    const outgoing = sanitizeEmailHtml(html);
    expect(outgoing).toContain('data-lexical-indent="1"');
    expect(outgoing).toContain('data-document-mention="true"');
    expect(outgoing).toContain('data-document-id="document-1"');
    expect(outgoing).toContain('data-scale="0.5"');
    expect(outgoing).not.toMatch(/onclick|onerror/);
    const reader = prepareEmailBody({ html }).html;
    expect(reader).not.toMatch(/data-|onclick|onerror/);
    expect(reader).toContain('href="https://example.com/spec"');
    expect(reader).toContain('>Spec</a>');
  });
  it('drops encoded HTML metadata that could bypass scrubbing during editor import', () => {
    const html =
      '<div data-html-render="true" data-html="&quot;&lt;img src=x onerror=alert(1)&gt;&quot;">Safe fallback</div>';
    const outgoing = sanitizeEmailHtml(html);
    expect(outgoing).toContain('data-html-render="true"');
    expect(outgoing).not.toContain('data-html=');
    expect(outgoing).not.toContain('onerror');
    expect(outgoing).toContain('Safe fallback');
  });
  it('normalizes frameset documents to an empty inert body', () => {
    const html = '<frameset><frame src="https://example.com"></frameset>';
    expect(prepareEmailBody({ html })).toMatchObject({
      html: '',
      hasTable: false,
    });
    expect(sanitizeEmailHtml(html)).toBe('<head></head><body></body>');
  });
  it.each([
    ['body preparation', (html: string) => prepareEmailBody({ html }).html],
    ['HTML sanitization', sanitizeEmailHtml],
  ])(
    '%s handles deeply nested content without exposing removed markup',
    (_, render) => {
      const html =
        '<p>Before</p>' +
        '<div>left'.repeat(5000) +
        'Middle<img src="cid:part"><form><p>Hidden form</p></form><script>Hidden script</script>' +
        'right</div>'.repeat(5000) +
        '<p>After</p>';
      const result = render(html);
      expect(result.replace(/<[^>]*>/g, '')).toBe(
        'Before' +
          'left'.repeat(5000) +
          'Middle' +
          'right'.repeat(5000) +
          'After'
      );
      expect(result).toContain('<img src="cid:part">');
      expect(result).not.toMatch(/Hidden|<form|<script/);
    }
  );
  it('is deterministic and leaves inputs unchanged', () => {
    const input = Object.freeze({
      html: '<p>Hello<br><br></p><div class="gmail_signature">Signature</div>',
    });
    const first = prepareEmailBody(input);
    expect(first).toEqual(prepareEmailBody(input));
    expect(JSON.parse(JSON.stringify(first))).toEqual(first);
    expect(first.html).toBe('<p>Hello</p>');
    expect(first.hasHiddenContent).toBe(true);
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
    const html =
      '<head><style>p { color: red }</style></head><body><p>A<br></p><span class="gmail_signature_prefix">--</span><div class="gmail_signature">Me</div></body>';
    expect(prepareEmailBody({ html })).toMatchObject({
      html: '<style>p{color:red}</style>\n<p>A</p>',
      hasHiddenContent: true,
    });
    expect(
      prepareEmailBody({ html }, { showQuotedContent: true }).html
    ).toContain('<div class="gmail_signature">Me</div>');
  });
  it.each(['<p>A<br><br></p>  ', '<div><p>A</p><div><br></div></div>'])(
    'trims trailing breaks and empty wrappers: %s',
    (html) => {
      const body = prepareEmailBody({ html });
      expect(body.html).not.toContain('<br>');
      expect(body.html).toContain('A');
    }
  );
  it('keeps trailing images and meaningful text', () => {
    expect(
      prepareEmailBody({ html: '<p>A</p><img src="cid:a">' }).html
    ).toContain('<img');
    expect(prepareEmailBody({ html: '<p>A<br>B</p>' }).html).toContain(
      'A<br>B'
    );
  });
  it('trims trailing breaks through empty styles without discarding meaningful styles', () => {
    const body = prepareEmailBody({
      html: '<p>Hello<br><br><br></p><style></style>',
    });
    expect(body.html).toBe('<p>Hello</p>');
    expect(
      prepareEmailBody({ html: '<p>Hello</p><style>p{color:red}</style>' }).html
    ).toContain('<style>p{color:red}</style>');
  });
  it.each(['\u00a0', '\u000b'])(
    'does not mistake a class containing %j for a signature or quote',
    (separator) => {
      const body = prepareEmailBody({
        html: `<p class="gmail_signature${separator}main">Message body</p><div class="macro_quote${separator}main">More content</div>`,
      });
      expect(body.html).toContain('Message body');
      expect(body.html).toContain('More content');
      expect(body.hasHiddenContent).toBe(false);
    }
  );
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
      '<style>:h\\6fst{color:red}p{background:i\\6d age-set("https://evil.test/a" 1x)}</style>',
      { remote: 'block' }
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
    const result = sanitizeEmailHtml('<p>Safe content</p>' + html);
    expect(result).toContain('<p>Safe content</p>');
    expect(result).not.toMatch(
      /onerror|alert\(|<script|<iframe|<svg|<math|<form|<input|<template|ping=/
    );
  });
  it('preserves relative and CID links but forbids data navigation', () => {
    const result = sanitizeEmailHtml(
      '<a href="mailto:a@example.com">mail</a><a href="https://example.com">web</a><a href="data:image/png;base64,AAAA">data</a><a href="/document">relative</a><a href="cid:part">part</a>'
    );
    expect(result).toContain('href="mailto:a@example.com"');
    expect(result).toContain('href="https://example.com"');
    expect(result).not.toContain('href="data:');
    expect(result).toContain('href="/document"');
    expect(result).toContain('href="cid:part"');
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
    expect(result.html).toContain('Text');
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
  it('preserves nested dark rules while stripping host selectors and unsafe CSS escapes', () => {
    const result = prepareEmailBody({
      html: '<style>@media screen{@media(prefers-color-scheme:dark){p{color:white}}p{color:red}}:host{position:fixed}p{background:url(javascript:alert)}p{color:blue}</style>',
    }).html;
    expect(result).not.toMatch(/:host|javascript/);
    expect(result).toContain('prefers-color-scheme');
    expect(result).toContain('color:red');
    expect(result).toContain('color:blue');
  });
  it('applies the legacy theme policy only to top-level media rules in head styles', () => {
    const html =
      '<head><style>@media(prefers-color-scheme:dark){.head{color:red}}@media screen{@media(prefers-color-scheme:dark){.nested{color:green}}}</style></head><body><style>@media(prefers-color-scheme:dark){.body{color:blue}}</style><p>Hello</p></body>';
    const result = prepareEmailBody({ html }).html;
    expect(result).not.toContain('.head');
    expect(result).toContain('.nested{color:green}');
    expect(result).toContain('.body{color:blue}');
  });
  it('preserves safe dark-mode rules in quoted HTML and applies reader policy separately', () => {
    const html =
      '<style>@media(prefers-color-scheme:dark){p{color:white}}</style><p>Quoted</p>';
    expect(sanitizeEmailHtml(html)).toContain('prefers-color-scheme');
    expect(prepareEmailBody({ html }).html).not.toContain(
      'prefers-color-scheme'
    );
  });
  it('preserves unrelated valid declarations when CSS contains a recoverable error', () => {
    const result = sanitizeEmailHtml(
      '<style>.preheader{display:none;color:red !;}.message{font-size:32px;padding:24px}</style><p style="padding:12px;color:red !;margin:8px">Hello</p>'
    );
    expect(result).toContain('.preheader{display:none}');
    expect(result).toContain('.message{font-size:32px;padding:24px}');
    expect(result).toContain('style="padding:12px;margin:8px"');
    expect(result).not.toContain('red !');
  });
  it('preserves native CSS variables and fallbacks under the normal reader policy', () => {
    const html =
      '<style>.message{--tone:red;color:var(--tone,var(--missing,blue));--picture:url(https://example.com/image);background:var(--picture,url(https://example.com/fallback))}</style><p class="message">Hello</p>';
    expect(sanitizeEmailHtml(html)).toContain(
      'color:var(--tone,var(--missing,blue))'
    );
    const body = prepareEmailBody({ html });
    expect(body.html).toContain('color:var(--tone,var(--missing,blue))');
    const blocked = prepareEmailBody(
      { html },
      { images: { remote: 'block' } }
    ).html;
    expect(blocked).not.toContain('example.com');
    expect(blocked).not.toContain('var(');
  });
  it('normalizes protocol-relative resources and keeps safe image-map links', () => {
    const html =
      '<a href="//example.com/open">Open</a><map name="offer"><area href="//example.com/accept" shape="rect" coords="0,0,20,20"></map><img src="//example.com/image" usemap="#offer">';
    const result = sanitizeEmailHtml(html);
    expect(result).toContain('href="https://example.com/open"');
    expect(result).toContain('<area href="https://example.com/accept"');
    expect(result).toContain('src="https://example.com/image"');
    expect(
      prepareEmailBody({ html }, { images: { remote: 'block' } }).html
    ).not.toContain('src=');
  });
  it('retains safe CSS grouping and namespace rules', () => {
    const html =
      '<style>@namespace h url(http://www.w3.org/1999/xhtml);@layer email{@scope (.message){h|p{font-size:32px;color:red}}}</style><div class="message"><p>Hello</p></div>';
    const result = prepareEmailBody({ html }).html;
    expect(result).toContain('@namespace h url(http://www.w3.org/1999/xhtml)');
    expect(result).toContain(
      '@layer email{@scope (.message){h|p{font-size:32px;color:red}}}'
    );
  });
  it('retains static image-set URLs under the allow policy and blocks indirect loads', () => {
    const html =
      '<p style="background:image-set(\'//example.com/a\' 1x,url(https://example.com/b) 2x)">A</p><p style="--source:\'https://example.com/indirect\';background:image-set(var(--source) 1x)">B</p>';
    expect(sanitizeEmailHtml(html)).toContain(
      'image-set(&quot;https://example.com/a&quot;1x,url(https://example.com/b)2x)'
    );
    const blocked = prepareEmailBody({ html }, { images: { remote: 'block' } });
    expect(blocked.html).not.toContain('background:');
  });
  it('never allows CSS strings to break out of a style element', () => {
    const result = sanitizeEmailHtml(
      '<style>p::after{content:"< /style>"}</style>'
    );
    expect(result).not.toContain('content:"<');
  });
});
