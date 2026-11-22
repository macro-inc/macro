import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test as base, expect } from '@playwright/test';

const sha256 = (bytes: Uint8Array | string) =>
  createHash('sha256').update(bytes).digest('hex');

/** Bind each Source execution to its actual served production bundle and map. */
export const test = base.extend<{ sourceProof: undefined }>({
  sourceProof: [
    async ({ page }, use, info) => {
      const scripts: Promise<{
        url: string;
        path: string;
        sha256: string;
        mapSHA256: string;
        lexicalSource: string[];
      }>[] = [];
      page.on('response', (response) => {
        const url = new URL(response.url());
        if (
          !url.pathname.startsWith('/assets/') ||
          !url.pathname.endsWith('.js')
        )
          return;
        scripts.push(
          response.body().then((bytes) => {
            const path = resolve(
              import.meta.dirname,
              '..',
              process.env.NATIVE_ENTER_DIST ?? 'dist/normal-enter',
              url.pathname.slice(1)
            );
            expect(bytes.equals(readFileSync(path))).toBe(true);
            const mapBytes = readFileSync(path + '.map');
            const map: {
              sources: string[];
              sourcesContent: (string | null)[];
            } = JSON.parse(mapBytes.toString());
            const lexicalSource: string[] = [];
            for (const [index, source] of map.sources.entries()) {
              if (!source.endsWith('/lexical/dist/Lexical.prod.mjs')) continue;
              const content = map.sourcesContent[index];
              expect(typeof content).toBe('string');
              if (content === null || content === undefined)
                throw new Error('Missing compiled Lexical Source');
              const hash = sha256(content);
              expect(hash).toBe(
                '4678405ecd2750dae7e76a2ad704251f8112cfaa95fe028349f93f1dad1f964a'
              );
              lexicalSource.push(hash);
            }
            return {
              url: response.url(),
              path,
              sha256: sha256(bytes),
              mapSHA256: sha256(mapBytes),
              lexicalSource,
            };
          })
        );
      });
      await use(undefined);
      const actual = await Promise.all(scripts);
      expect(actual.length).toBeGreaterThan(0);
      expect(actual.flatMap((row) => row.lexicalSource).length).toBeGreaterThan(
        0
      );
      await info.attach('compiled-source-proof', {
        body: JSON.stringify(actual),
        contentType: 'application/json',
      });
    },
    { auto: true },
  ],
});
export { expect };
