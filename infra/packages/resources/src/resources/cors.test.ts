import { describe, expect, mock, test } from 'bun:test';

const fixedLocalPorts = ['http', 'https'].flatMap((scheme) =>
  Array.from({ length: 10 }, (_, i) => `${scheme}://localhost:${3000 + i}`)
);

async function originsFor(stack: string): Promise<string[]> {
  mock.module('../../../shared', () => ({ stack }));
  // A distinct specifier per stack makes Bun evaluate cors.ts again.
  const { ALLOWED_ORIGINS } = await import(`./cors.ts?stack=${stack}`);
  return ALLOWED_ORIGINS;
}

describe('ALLOWED_ORIGINS', () => {
  test('prod allows only the fixed local ports', async () => {
    const origins = await originsFor('prod');
    expect(origins.slice(0, fixedLocalPorts.length)).toEqual(fixedLocalPorts);
    expect(origins).not.toContain('http://localhost:*');
    expect(origins).not.toContain('https://localhost:*');
  });

  test('non-prod stacks allow any local port', async () => {
    const prod = await originsFor('prod');
    for (const stack of ['dev', 'local']) {
      const origins = await originsFor(stack);
      expect(origins.slice(0, 2)).toEqual([
        'http://localhost:*',
        'https://localhost:*',
      ]);
      expect(origins.slice(2)).toEqual(prod.slice(fixedLocalPorts.length));
    }
  });

  test('each origin has at most one wildcard, as S3 requires', async () => {
    for (const stack of ['dev', 'prod']) {
      for (const origin of await originsFor(stack)) {
        expect(origin.split('*').length).toBeLessThanOrEqual(2);
      }
    }
  });
});
