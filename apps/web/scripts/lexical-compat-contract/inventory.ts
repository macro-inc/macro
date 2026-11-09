import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import ts from 'typescript';
import { z } from 'zod';
import { declarationSpecifier } from './resolution';

export const BINDINGS = z
  .record(z.string(), z.array(z.string()))
  .parse(
    JSON.parse(
      readFileSync(new URL('./bindings.json', import.meta.url), 'utf8')
    )
  );
export const SPECIFIERS = Object.entries(BINDINGS).flatMap(([name, paths]) =>
  paths.map((path) => (path === '.' ? name : name + '/' + path.slice(2)))
);

export function sourceFiles(directory: string): string[] {
  if (!existsSync(directory))
    throw new Error('Missing source inventory directory: ' + directory);
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory())
      return ['node_modules', '__tests__', 'browser-test', 'tests'].includes(
        entry.name
      )
        ? []
        : sourceFiles(path);
    return /\.[cm]?[jt]sx?$/.test(path) && !/[.](test|spec)[.]/.test(path)
      ? [path]
      : [];
  });
}

export function publicTarget(value: unknown): string | undefined {
  if (typeof value === 'string')
    return /\.[cm]?tsx?$/.test(value) && !/\.d\.[cm]?ts$/.test(value)
      ? value
      : undefined;
  const parsed = z.record(z.string(), z.unknown()).safeParse(value);
  if (!parsed.success) return;
  for (const key of ['source', 'import', 'default', 'types']) {
    const found = publicTarget(parsed.data[key]);
    if (found) return found;
  }
}

export function verifyDirectImports(files: string[]) {
  const allowed = new Set(SPECIFIERS);
  for (const path of files) {
    const source = ts.createSourceFile(
      path,
      readFileSync(path, 'utf8'),
      ts.ScriptTarget.Latest,
      true
    );
    const check = (value: string) => {
      value = declarationSpecifier(value);
      if (
        (value === 'lexical' || value.startsWith('@lexical/')) &&
        !allowed.has(value)
      )
        throw new Error(
          'Bound Lexical import missing namespace contract: ' +
            value +
            ' in ' +
            path
        );
    };
    const visit = (node: ts.Node) => {
      if (
        (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
        node.moduleSpecifier &&
        ts.isStringLiteralLike(node.moduleSpecifier)
      )
        check(node.moduleSpecifier.text);
      if (
        ts.isImportTypeNode(node) &&
        ts.isLiteralTypeNode(node.argument) &&
        ts.isStringLiteralLike(node.argument.literal)
      )
        check(node.argument.literal.text);
      if (
        ts.isImportEqualsDeclaration(node) &&
        ts.isExternalModuleReference(node.moduleReference) &&
        node.moduleReference.expression &&
        ts.isStringLiteralLike(node.moduleReference.expression)
      )
        check(node.moduleReference.expression.text);
      if (
        ts.isImportTypeNode(node) &&
        ts.isLiteralTypeNode(node.argument) &&
        ts.isStringLiteralLike(node.argument.literal)
      )
        check(node.argument.literal.text);
      if (
        ts.isImportEqualsDeclaration(node) &&
        ts.isExternalModuleReference(node.moduleReference) &&
        node.moduleReference.expression &&
        ts.isStringLiteralLike(node.moduleReference.expression)
      )
        check(node.moduleReference.expression.text);
      if (
        ts.isCallExpression(node) &&
        (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
          (ts.isIdentifier(node.expression) &&
            node.expression.text === 'require')) &&
        node.arguments[0] &&
        ts.isStringLiteralLike(node.arguments[0])
      )
        check(node.arguments[0].text);
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
}

export function compatEntry(root: string, specifier: string) {
  const suffix =
    specifier === 'lexical' ? '.' : './' + specifier.slice('@lexical/'.length);
  const metadata = z
    .object({ exports: z.record(z.string(), z.unknown()).optional() })
    .parse(JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')));
  const target = publicTarget(metadata.exports?.[suffix]);
  // The root source is the producer's real implementation, including before publication.
  if (!target && suffix === '.') return join(root, 'src/index.ts');
  return target ? resolve(root, target) : undefined;
}

export function upstreamRuntimeFiles(repo: string): string[] {
  const files = new Set<string>();
  const inspect = (path: string) => {
    if (files.has(path)) return;
    files.add(path);
    const source = ts.createSourceFile(
      path,
      readFileSync(path, 'utf8'),
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.JS
    );
    const visit = (node: ts.Node) => {
      if (
        (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
        node.moduleSpecifier &&
        ts.isStringLiteralLike(node.moduleSpecifier)
      ) {
        const imported = node.moduleSpecifier.text;
        if (imported.startsWith('.')) {
          const target = resolve(dirname(path), imported);
          if (existsSync(target)) inspect(target);
        } else if (
          (imported === 'lexical' || imported.startsWith('@lexical/')) &&
          !SPECIFIERS.includes(imported)
        )
          throw new Error(
            'Upstream runtime import missing contract: ' + imported
          );
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  };
  const runtimeTarget = (value: unknown): string | undefined => {
    if (typeof value === 'string') return value;
    const parsed = z.record(z.string(), z.unknown()).safeParse(value);
    if (!parsed.success) return;
    for (const key of ['import', 'development', 'browser', 'default', 'node']) {
      const found = runtimeTarget(parsed.data[key]);
      if (found) return found;
    }
  };
  for (const [name, subpaths] of Object.entries(BINDINGS)) {
    const root = join(repo, 'node_modules', name);
    const metadata = z
      .object({
        version: z.literal('0.45.0'),
        exports: z.record(z.string(), z.unknown()),
      })
      .parse(JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')));
    for (const subpath of subpaths) {
      const target = runtimeTarget(metadata.exports[subpath]);
      if (!target)
        throw new Error(
          'Missing pinned runtime export ' + name + '/' + subpath
        );
      inspect(resolve(root, target));
    }
  }
  return [...files];
}
