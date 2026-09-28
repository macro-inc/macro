// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import ts from 'typescript';
import { expect, it } from 'vitest';

it('keeps the transitive core import graph inside the framework-free core', () => {
  const root = resolve(import.meta.dirname, '../src/core');
  for (const file of readdirSync(root, {
    recursive: true,
    encoding: 'utf8',
  }).filter((name) => name.endsWith('.ts'))) {
    const path = resolve(root, file);
    const source = ts.createSourceFile(
      path,
      readFileSync(path, 'utf8'),
      ts.ScriptTarget.Latest,
      true
    );
    function visit(node: ts.Node) {
      if (
        (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
        node.moduleSpecifier &&
        ts.isStringLiteral(node.moduleSpecifier)
      ) {
        const specifier = node.moduleSpecifier.text;
        if (specifier === 'perfect-freehand') {
          expect(file).toBe('shapes/pencil.ts');
          return;
        }
        if (specifier === 'fractional-indexing') {
          expect(file).toBe('ordering.ts');
          return;
        }
        expect(specifier.startsWith('.')).toBe(true);
        expect(resolve(dirname(path), specifier).startsWith(`${root}/`)).toBe(
          true
        );
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
});
