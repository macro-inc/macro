import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';

/** Include static, type-only, reexport and literal dynamic/require imports. */
export function imports(source: ts.SourceFile): string[] {
  const names = new Set<string>();
  const accept = (name: string) => {
    if (name === 'lexical' || name.startsWith('@lexical/')) names.add(name);
  };
  const visit = (node: ts.Node) => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteralLike(node.moduleSpecifier)
    )
      accept(node.moduleSpecifier.text);
    if (
      ts.isImportTypeNode(node) &&
      ts.isLiteralTypeNode(node.argument) &&
      ts.isStringLiteralLike(node.argument.literal)
    )
      accept(node.argument.literal.text);
    if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference) &&
      node.moduleReference.expression &&
      ts.isStringLiteralLike(node.moduleReference.expression)
    )
      accept(node.moduleReference.expression.text);
    if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) &&
          node.expression.text === 'require')) &&
      node.arguments[0] &&
      ts.isStringLiteralLike(node.arguments[0])
    )
      accept(node.arguments[0].text);
    ts.forEachChild(node, visit);
  };
  visit(source);
  return [...names].sort();
}

export function discover(repository: string) {
  const callers = new Map<string, string[]>();
  const roots = [
    'apps/web/src',
    'packages/lexical-core',
    'packages/lexical-wasm-view/src',
    'packages/collaboration/src',
  ];
  for (const root of roots) {
    for (const file of ts.sys.readDirectory(
      join(repository, root),
      ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx'],
      [
        '**/node_modules/**',
        '**/__tests__/**',
        '**/tests/**',
        '**/browser-test/**',
        '**/*.test.*',
        '**/*.spec.*',
      ]
    )) {
      const source = ts.createSourceFile(
        file,
        readFileSync(file, 'utf8'),
        ts.ScriptTarget.Latest,
        true
      );
      for (const name of imports(source)) {
        const existing = callers.get(name) ?? [];
        existing.push(file);
        callers.set(name, existing);
      }
    }
  }
  if (!callers.has('lexical'))
    throw new Error('The actual app import inventory lost lexical');
  return callers;
}

export function declarationNames(entry: string, options: ts.CompilerOptions) {
  const program = ts.createProgram([entry], options);
  const source = program.getSourceFile(entry);
  if (!source) throw new Error('Declaration entry was not loaded: ' + entry);
  const checker = program.getTypeChecker();
  const module = checker.getSymbolAtLocation(source);
  if (!module) throw new Error('Declaration entry has no module: ' + entry);
  return checker
    .getExportsOfModule(module)
    .map((symbol) => symbol.name)
    .sort();
}
