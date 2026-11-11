import { relative, resolve } from 'node:path';
import ts from 'typescript';

export const wildcardAliases: Readonly<Record<string, string>> = {
  AnyLexicalExtension:
    'export type AnyLexicalExtension = LexicalExtension<any, string, any, any>;',
  AnyLexicalExtensionArgument:
    'export type AnyLexicalExtensionArgument = AnyLexicalExtension | AnyNormalizedLexicalExtensionArgument;',
  AnyNormalizedLexicalExtensionArgument:
    'export type AnyNormalizedLexicalExtensionArgument = NormalizedLexicalExtensionArgument<any, string, any, any>;',
  OutputExtension:
    'export type OutputExtension<Output> = LexicalExtension<any, any, Output, any>;',
};

function normalized(text: string): string {
  const source = ts.createSourceFile(
    'wildcards.ts',
    text,
    ts.ScriptTarget.Latest,
    true
  );
  return ts
    .createPrinter({ newLine: ts.NewLineKind.LineFeed })
    .printFile(source);
}

/** Match the complete alias, including its generic positions and actual self graph. */
export function approvedWildcardAny(node: ts.Node): boolean {
  if (node.kind !== ts.SyntaxKind.AnyKeyword) return false;
  let parent = node.parent;
  while (parent && !ts.isTypeAliasDeclaration(parent)) parent = parent.parent;
  if (!parent || !ts.isTypeAliasDeclaration(parent)) return false;
  const expected = wildcardAliases[parent.name.text];
  return (
    expected !== undefined &&
    normalized(parent.getText()) === normalized(expected)
  );
}

function verifyTypePosition(node: ts.Identifier, local: string): void {
  const parent = node.parent;
  if (
    !ts.isTypeReferenceNode(parent) &&
    !ts.isImportSpecifier(parent) &&
    !ts.isExportSpecifier(parent) &&
    !(ts.isTypeAliasDeclaration(parent) && parent.name === node)
  )
    throw new Error(
      'Wildcard alias used outside approved type positions: ' + local
    );
  if (ts.isImportSpecifier(parent)) {
    const clause = parent.parent.parent;
    if (!parent.isTypeOnly && !clause.isTypeOnly)
      throw new Error('Wildcard aliases require type-only imports');
  }
  if (ts.isExportSpecifier(parent)) {
    const declaration = parent.parent.parent;
    if (!parent.isTypeOnly && !declaration.isTypeOnly)
      throw new Error('Wildcard aliases require type-only exports');
  }
}

/** Enumerate exact symbol uses, including type imports/exports, without line-number authority. */
export function verifyWildcardTypes(
  program: ts.Program,
  central: ts.SourceFile,
  sourceRoot: string,
  expectedReferences: readonly string[]
) {
  const checker = program.getTypeChecker();
  const symbols = new Set<ts.Symbol>();
  const aliases = central.statements
    .filter(ts.isTypeAliasDeclaration)
    .filter((alias) => Object.hasOwn(wildcardAliases, alias.name.text));
  if (
    aliases.length !== 4 ||
    aliases.some(
      (alias) =>
        normalized(alias.getText()) !==
        normalized(wildcardAliases[alias.name.text] ?? '')
    )
  )
    throw new Error(
      'Public wildcard alias definitions differ from the four approved types'
    );
  for (const alias of aliases) {
    const symbol = checker.getSymbolAtLocation(alias.name);
    if (!symbol) throw new Error('Wildcard alias symbol is unavailable');
    symbols.add(symbol);
  }
  const references: string[] = [];
  let anyKeywords = 0;
  for (const file of program.getSourceFiles()) {
    const path = resolve(file.fileName);
    const local = relative(sourceRoot, path).split('\\').join('/');
    if (local.startsWith('../') || local === '..') continue;
    const visit = (node: ts.Node) => {
      if (node.kind === ts.SyntaxKind.AnyKeyword) {
        if (file !== central || !approvedWildcardAny(node))
          throw new Error('Unapproved type-level any: ' + local);
        anyKeywords++;
      }
      if (ts.isIdentifier(node)) {
        let symbol = checker.getSymbolAtLocation(node);
        if (symbol?.flags && symbol.flags & ts.SymbolFlags.Alias)
          symbol = checker.getAliasedSymbol(symbol);
        if (symbol && symbols.has(symbol)) {
          verifyTypePosition(node, local);
          references.push(
            local + ':' + symbol.name + ':' + ts.SyntaxKind[node.parent.kind]
          );
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(file);
  }
  if (anyKeywords !== 9)
    throw new Error('Exactly nine approved type-level any tokens are required');
  if (
    references.slice().sort().join('\n') !==
    expectedReferences.slice().sort().join('\n')
  )
    throw new Error(
      'Wildcard type reference inventory differs from manifest: ' +
        JSON.stringify(references)
    );
  return { anyKeywords, references };
}
