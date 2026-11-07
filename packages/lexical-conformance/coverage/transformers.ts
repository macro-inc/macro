import { readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { files, root } from './evidence';
import type { Seed } from './matrix';

let exported: Map<string, string[]> | undefined;
/** Resolve transformer evidence through declared exports, never suffix matching. */
export function transformerReferences(
  row: Pick<Seed, 'id' | 'package'>
): string[] {
  const name = row.id.slice('S3:tf:'.length);
  if (row.package === 'lexical_markdown') return [`@lexical/markdown.${name}`];
  if (row.package !== 'macro_document_model') return [];
  if (!exported) {
    exported = new Map();
    const base = path.join(root, 'packages/lexical-core');
    for (const file of files(base).filter(
      (file) => /\.tsx?$/.test(file) && !file.includes('/tests/')
    )) {
      const source = ts.createSourceFile(
        file,
        readFileSync(file, 'utf8'),
        ts.ScriptTarget.Latest,
        true
      );
      for (const statement of source.statements) {
        if (
          !ts.isVariableStatement(statement) ||
          !statement.modifiers?.some(
            (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword
          )
        )
          continue;
        for (const declaration of statement.declarationList.declarations) {
          if (!ts.isIdentifier(declaration.name)) continue;
          const symbol = declaration.name.text;
          const reference =
            '@macro-inc/lexical-core/' +
            path.relative(base, file).replace(/\.tsx?$/, '') +
            '.' +
            symbol;
          const references =
            declaration.initializer &&
            ts.isArrayLiteralExpression(declaration.initializer)
              ? declaration.initializer.elements.map(
                  (_, i) => reference + '.' + i
                )
              : [reference];
          exported.set(symbol, [
            ...(exported.get(symbol) ?? []),
            ...references,
          ]);
        }
      }
    }
  }
  return exported.get(name) ?? [];
}
