// @vitest-environment node
import fs from 'node:fs';
import { URL } from 'node:url';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { compactEdgeRedirects } from '../seo/edge-redirects';
import redirects from '../seo/page-redirects.json';

const source = fs
  .readFileSync(
    new URL(
      '../../../infra/stacks/website/wwwRedirect/handler.js',
      import.meta.url
    ),
    'utf8'
  )
  .replace(
    '__PAGE_REDIRECTS__',
    JSON.stringify(compactEdgeRedirects(redirects))
  );
const handler = vm.runInNewContext(`${source}; handler`);

describe('consolidated website redirects', () => {
  it('fits CloudFront’s function size limit', () => {
    expect(Buffer.byteLength(source)).toBeLessThan(10_000);
  });
  it('redirects all retired paths directly and preserves repeated query values', () => {
    for (const [from, to] of Object.entries(redirects)) {
      expect(redirects).not.toHaveProperty(to);
      const variants = from.endsWith('.md')
        ? [from]
        : [from, `${from}/`, `${from}/index.html`];
      for (const uri of variants) {
        const response = handler({
          request: {
            uri,
            headers: { host: { value: 'www.macro.com' } },
            cookies: {},
            querystring: {
              tag: { multiValue: [{ value: 'a' }, { value: 'b%20c' }] },
            },
          },
        });
        expect(response.statusCode).toBe(308);
        expect(response.headers.location.value).toBe(
          `https://macro.com${to}?tag=a&tag=b%20c`
        );
      }
    }
  });
  it('leaves active pages on their existing index rewrite path', () => {
    const response = handler({
      request: {
        uri: '/tasks',
        headers: { host: { value: 'macro.com' } },
        cookies: {},
        querystring: {},
      },
    });
    expect(response.uri).toBe('/tasks/index.html');
  });
});
