import { deepStrictEqual } from 'node:assert';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, realpathSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';
import * as ts from 'typescript';

const appDirectory = fileURLToPath(new URL('../', import.meta.url));
const cacheDirectory = resolve(
  appDirectory,
  'node_modules/.vite-list-wrapper/deps'
);
const expected = new Map([
  [
    'Lexical.dev.mjs',
    '449d061d3198fff549cf53786b589b99e298cb2ff368d88607a65494c66158ab',
  ],
  [
    'LexicalCodeCore.dev.mjs',
    'df638b4f9cc3a2926d6bfe291095fa19e62177905cf4d047d02e4424700ac6e5',
  ],
]);
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
export function sha256(bytes: Uint8Array | string) {
  return createHash('sha256').update(bytes).digest('hex');
}

/** Verify the exact app cache, rather than a worktree-root cache or package files alone. */
export function verifyCompiledSourceDeps() {
  const rows: {
    source: string;
    sourceSHA256: string;
    mapPath: string;
    mapSHA256: string;
    jsPath: string;
    jsSHA256: string;
  }[] = [];
  for (const name of readdirSync(cacheDirectory)) {
    if (!name.endsWith('.map')) continue;
    const mapPath = resolve(cacheDirectory, name);
    const bytes = readFileSync(mapPath);
    const parsed: unknown = JSON.parse(bytes.toString('utf8'));
    if (
      !record(parsed) ||
      !Array.isArray(parsed.sources) ||
      !Array.isArray(parsed.sourcesContent)
    )
      throw new Error(`Invalid compiled dependency map: ${mapPath}`);
    const sources: readonly unknown[] = parsed.sources;
    const contents: readonly unknown[] = parsed.sourcesContent;
    for (const [index, source] of sources.entries()) {
      if (typeof source !== 'string')
        throw new Error('Invalid source map filename');
      const pinned = expected.get(basename(source));
      if (!pinned) continue;
      const content = contents[index];
      if (typeof content !== 'string' || sha256(content) !== pinned)
        throw new Error(`Non-pristine compiled Source dependency: ${source}`);
      const jsPath = realpathSync(mapPath.slice(0, -4));
      rows.push({
        source,
        sourceSHA256: pinned,
        mapPath: realpathSync(mapPath),
        mapSHA256: sha256(bytes),
        jsPath,
        jsSHA256: sha256(readFileSync(jsPath)),
      });
    }
  }
  if (
    rows.length !== 2 ||
    new Set(rows.map((row) => basename(row.source))).size !== 2
  )
    throw new Error(
      'Both pristine compiled Source dependencies must be present exactly once'
    );
  return {
    cacheDirectory: realpathSync(cacheDirectory),
    metadataSHA256: sha256(
      readFileSync(resolve(cacheDirectory, '_metadata.json'))
    ),
    rows,
  };
}

/** Resolve the actual Vite script URL back to the exact cache file being verified. */
export function servedFile(url: string) {
  const path = decodeURIComponent(new URL(url).pathname);
  const fs = path.indexOf('/@fs/');
  if (fs !== -1) return realpathSync(resolve('/', path.slice(fs + 5)));
  const relative = path.startsWith('/app/') ? path.slice(5) : path.slice(1);
  return realpathSync(resolve(appDirectory, relative));
}

interface ImportSpan {
  start: number;
  end: number;
  specifier: string;
}
function dependencyCode(text: string) {
  // This final non-executable directive may be re-emitted by Vite.
  const code = text.replace(/\n\/\/# sourceMappingURL=[^\r\n]*(?:\r?\n)?$/, '');
  const file = ts.createSourceFile(
    'compiled.js',
    code,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS
  );
  const spans: ImportSpan[] = [];
  const visit = (node: ts.Node) => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteralLike(node.moduleSpecifier)
    ) {
      spans.push({
        start: node.moduleSpecifier.getStart(file) + 1,
        end: node.moduleSpecifier.end - 1,
        specifier: node.moduleSpecifier.text,
      });
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword
    ) {
      const argument = node.arguments[0];
      if (argument && ts.isStringLiteralLike(argument))
        spans.push({
          start: argument.getStart(file) + 1,
          end: argument.end - 1,
          specifier: argument.text,
        });
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  spans.sort((left, right) => left.start - right.start);
  let withoutImportURLs = code;
  for (const span of [...spans].reverse())
    withoutImportURLs =
      withoutImportURLs.slice(0, span.start) +
      '<verified-import-url>' +
      withoutImportURLs.slice(span.end);
  return { spans, withoutImportURLs };
}

/** Accept only Vite's equivalent module-URL rewrites, never changes to executable SDK code. */
function verifyServedBody(
  cached: Buffer,
  response: Buffer,
  file: string,
  url: string
) {
  if (cached.equals(response)) return [];
  const original = dependencyCode(cached.toString('utf8'));
  const served = dependencyCode(response.toString('utf8'));
  deepStrictEqual(served.withoutImportURLs, original.withoutImportURLs);
  deepStrictEqual(served.spans.length, original.spans.length);
  return original.spans.map((span, index) => {
    const target = served.spans[index];
    if (!target) throw new Error('Missing served import');
    if (span.specifier === target.specifier)
      return { cached: span.specifier, served: target.specifier };
    if (!span.specifier.startsWith('.'))
      throw new Error('Unexpected non-relative Vite import rewrite');
    const expectedFile = realpathSync(resolve(file, '..', span.specifier));
    const scriptURL = new URL(url);
    const importURL = new URL(target.specifier, scriptURL);
    deepStrictEqual(importURL.origin, scriptURL.origin);
    deepStrictEqual(importURL.hash, '');
    deepStrictEqual([...scriptURL.searchParams.keys()], ['v']);
    if (!scriptURL.searchParams.get('v'))
      throw new Error('Missing Vite dependency version');
    deepStrictEqual(importURL.search, scriptURL.search);
    const actualFile = servedFile(importURL.href);
    deepStrictEqual(actualFile, expectedFile);
    return {
      cached: span.specifier,
      served: target.specifier,
      file: actualFile,
    };
  });
}

/** Bind one browser execution to both pristine compiled dependency responses. */
export function watchCompiledSourceDeps(page: Page) {
  const before = verifyCompiledSourceDeps();
  const responses: Promise<{
    url: string;
    file: string;
    sha256: string;
    cacheSHA256: string;
    resourceType: string;
    importRewrites: { cached: string; served: string; file?: string }[];
    firstDifference?: { response: string; cache: string };
  }>[] = [];
  page.on('response', (response) => {
    if (response.request().resourceType() !== 'script') return;
    const url = response.url();
    const filename = new URL(url).pathname.split('/').at(-1);
    if (!before.rows.some((row) => basename(row.jsPath) === filename)) return;
    responses.push(
      response.body().then((body) => {
        const file = servedFile(url);
        const cached = readFileSync(file);
        const length = Math.min(body.length, cached.length);
        let at = 0;
        while (at < length && body[at] === cached[at]) at++;
        return {
          url,
          file,
          sha256: sha256(body),
          cacheSHA256: sha256(cached),
          resourceType: response.request().resourceType(),
          importRewrites: verifyServedBody(cached, body, file, url),
          firstDifference: body.equals(cached)
            ? undefined
            : {
                response: body
                  .subarray(Math.max(0, at - 60), at + 160)
                  .toString('utf8'),
                cache: cached
                  .subarray(Math.max(0, at - 60), at + 160)
                  .toString('utf8'),
              },
        };
      })
    );
  });
  return async () => {
    const loadedScripts = await Promise.all(responses);
    const after = verifyCompiledSourceDeps();
    for (const row of before.rows) {
      if (
        !loadedScripts.some(
          (script) =>
            script.file === row.jsPath && script.cacheSHA256 === row.jsSHA256
        )
      )
        throw new Error(
          `Browser did not load the verified app dependency: ${row.jsPath}`
        );
    }
    deepStrictEqual(after, before);
    return { before, loadedScripts, after };
  };
}
