import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';
import ts from 'typescript';
import { z } from 'zod';
import { sourceFiles } from './inventory';
import { verifyWildcardTypes, wildcardAliases } from './wildcard-types';

const manifestSchema = z.object({
  source: z.string(),
  implementationSha256: z.string().regex(/^[0-9a-f]{64}$/),
  exceptions: z.array(
    z.object({
      helper: z.string(),
      calls: z.array(z.string()),
      callForms: z.array(z.string()).default([]),
      reexports: z.array(z.string()).default([]),
    })
  ),
  typeOnlyException: z.object({
    kind: z.literal('public extension wildcard types (type-only)'),
    assertions: z.literal(0),
    anyKeywords: z.literal(9),
    aliases: z.record(z.string(), z.string()),
    references: z.array(z.string()),
  }),
  runtimeGuards: z
    .array(
      z.object({
        helper: z.literal('isInstanceOfKlass'),
        kind: z.literal('runtime-witness guard (sound)'),
        body: z.literal('return value instanceof klass;'),
        assertions: z.literal(0),
        calls: z.array(z.string()),
        reexports: z.array(z.string()).default([]),
      })
    )
    .length(1),
});
const approved = [
  'applyValueOrUpdater',
  'assumeNodeType',
  'commandBucket',
  'compareNumberWithUpstreamType',
  'createPointWithUpstreamType',
  'invokeDOMConversionWithNode',
  'nodeConfigRecord',
  'nodeStateToJSON',
];

function verifyRuntimeWitness(
  node: ts.FunctionDeclaration,
  checker: ts.TypeChecker,
  program: ts.Program
): void {
  const statements = node.body?.statements;
  const statement = statements?.[0];
  const expression =
    statement && ts.isReturnStatement(statement)
      ? statement.expression
      : undefined;
  if (
    statements?.length !== 1 ||
    expression === undefined ||
    !ts.isBinaryExpression(expression) ||
    expression.operatorToken.kind !== ts.SyntaxKind.InstanceOfKeyword ||
    !ts.isIdentifier(expression.left) ||
    expression.left.text !== 'value' ||
    !ts.isIdentifier(expression.right) ||
    expression.right.text !== 'klass'
  )
    throw new Error(
      'Runtime witness body must be exactly return value instanceof klass'
    );
  const [value, klass] = node.parameters;
  const generic = node.typeParameters?.[0];
  const constraint = generic?.constraint;
  const rest =
    constraint && ts.isConstructorTypeNode(constraint)
      ? constraint.parameters[0]
      : undefined;
  const result = node.type;
  if (
    node.parameters.length !== 2 ||
    value?.name.getText() !== 'value' ||
    value.type?.kind !== ts.SyntaxKind.UnknownKeyword ||
    value.initializer !== undefined ||
    value.questionToken !== undefined ||
    value.dotDotDotToken !== undefined ||
    klass?.name.getText() !== 'klass' ||
    klass.initializer !== undefined ||
    klass.questionToken !== undefined ||
    klass.dotDotDotToken !== undefined ||
    !klass.type ||
    !ts.isTypeReferenceNode(klass.type) ||
    klass.type.typeName.getText() !== 'T' ||
    node.typeParameters?.length !== 1 ||
    generic?.name.text !== 'T' ||
    !constraint ||
    !ts.isConstructorTypeNode(constraint) ||
    constraint.parameters.length !== 1 ||
    !constraint.modifiers?.some(
      (modifier) => modifier.kind === ts.SyntaxKind.AbstractKeyword
    ) ||
    constraint.type.kind !== ts.SyntaxKind.UnknownKeyword ||
    !rest?.dotDotDotToken ||
    !rest.type ||
    !ts.isArrayTypeNode(rest.type) ||
    rest.type.elementType.kind !== ts.SyntaxKind.NeverKeyword ||
    !result ||
    !ts.isTypePredicateNode(result) ||
    result.assertsModifier !== undefined ||
    result.parameterName.getText() !== 'value' ||
    !result.type ||
    !ts.isTypeReferenceNode(result.type) ||
    result.type.typeName.getText() !== 'InstanceType' ||
    result.type.typeArguments?.length !== 1 ||
    result.type.typeArguments[0].getText() !== 'T' ||
    node.asteriskToken !== undefined ||
    node.modifiers?.some(
      (modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword
    )
  )
    throw new Error(
      'Runtime witness must retain the exact unknown/constructor/InstanceType signature'
    );
  const utility =
    result &&
    ts.isTypePredicateNode(result) &&
    result.type &&
    ts.isTypeReferenceNode(result.type)
      ? checker.getSymbolAtLocation(result.type.typeName)
      : undefined;
  if (
    !utility?.declarations?.length ||
    !utility.declarations.every((declaration) =>
      program.isSourceFileDefaultLibrary(declaration.getSourceFile())
    )
  )
    throw new Error(
      'Runtime witness signature must use the canonical InstanceType utility'
    );
}

function enclosingFunction(node: ts.Node): string {
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (ts.isFunctionDeclaration(parent) || ts.isMethodDeclaration(parent))
      return parent.name?.getText() ?? '<anonymous>';
    if (ts.isFunctionExpression(parent) && parent.name) return parent.name.text;
    if (
      (ts.isArrowFunction(parent) || ts.isFunctionExpression(parent)) &&
      ts.isVariableDeclaration(parent.parent) &&
      ts.isIdentifier(parent.parent.name)
    )
      return parent.parent.name.text;
  }
  return '<top-level>';
}
function constantAssertion(node: ts.AsExpression | ts.TypeAssertion) {
  return (
    ts.isTypeReferenceNode(node.type) &&
    ts.isIdentifier(node.type.typeName) &&
    node.type.typeName.text === 'const'
  );
}
function importOrTypeReference(node: ts.Node) {
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (
      ts.isImportDeclaration(parent) ||
      ts.isTypeQueryNode(parent) ||
      ts.isImportTypeNode(parent)
    )
      return true;
    if (ts.isStatement(parent)) return false;
  }
  return false;
}

/** Verify exact approved source plus all direct uses; generated declarations stay generated. */
export function verifyExceptions(compatRoot: string, input: unknown) {
  const manifest = manifestSchema.parse(input);
  if (
    [...manifest.exceptions.map((entry) => entry.helper)].sort().join() !==
    approved.join()
  )
    throw new Error(
      'Exactly the eight approved exception helpers are required'
    );
  if (
    JSON.stringify(
      Object.entries(manifest.typeOnlyException.aliases).sort()
    ) !== JSON.stringify(Object.entries(wildcardAliases).sort())
  )
    throw new Error(
      'The type-only wildcard manifest must retain exactly four approved aliases'
    );
  const domInvocation = manifest.exceptions.find(
    (entry) => entry.helper === 'invokeDOMConversionWithNode'
  );
  if (
    domInvocation === undefined ||
    domInvocation.callForms.slice().sort().join() !==
      ['returned-arrow-body', 'variable-initializer'].join()
  )
    throw new Error(
      'DOM invocation requires exactly the factory and returned-converter call forms'
    );
  const central = resolve(compatRoot, manifest.source),
    sourceRoot = resolve(compatRoot, 'src');
  if (relative(sourceRoot, central) !== 'compatibility-exceptions.ts')
    throw new Error('Exception source must be the single central module');
  const hash = createHash('sha256').update(readFileSync(central)).digest('hex');
  if (hash !== manifest.implementationSha256)
    throw new Error(
      'Compatibility exception source hash differs from approved manifest'
    );
  const roots = sourceFiles(sourceRoot);
  const program = ts.createProgram(roots, {
    strict: true,
    noEmit: true,
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    types: [],
  });
  const checker = program.getTypeChecker();
  const boundedFunctions = [...manifest.exceptions, ...manifest.runtimeGuards];
  const helpers = new Map<string, string>();
  const calls = new Map<string, string[]>();
  const callForms: string[] = [];
  for (const entry of boundedFunctions) calls.set(entry.helper, []);
  const reexports = new Map<string, string[]>();
  const seenExports = new Set<ts.Node>();
  for (const entry of boundedFunctions) reexports.set(entry.helper, []);
  const assertions = new Map(
    manifest.exceptions.map((entry) => [entry.helper, 0])
  );
  const centralFile = program.getSourceFile(central);
  if (!centralFile) throw new Error('Central exception source was not loaded');
  if (createHash('sha256').update(centralFile.text).digest('hex') !== hash)
    throw new Error('Exception source changed during validation');
  const typeOnlyException = verifyWildcardTypes(
    program,
    centralFile,
    sourceRoot,
    manifest.typeOnlyException.references
  );
  const declarations = centralFile.statements.filter(ts.isFunctionDeclaration);
  if (
    declarations
      .map((statement) => statement.name?.text ?? '<anonymous>')
      .sort()
      .join() !==
    boundedFunctions
      .map((entry) => entry.helper)
      .sort()
      .join()
  )
    throw new Error(
      'Central function list differs from eight assertions and declared runtime-witness guards'
    );
  for (const guard of manifest.runtimeGuards) {
    const declaration = declarations.find(
      (statement) => statement.name?.text === guard.helper
    );
    if (declaration === undefined)
      throw new Error('Runtime witness was not loaded');
    verifyRuntimeWitness(declaration, checker, program);
  }
  for (const statement of centralFile.statements)
    if (ts.isFunctionDeclaration(statement) && statement.name) {
      const symbol = checker.getSymbolAtLocation(statement.name);
      if (symbol) helpers.set(statement.name.text, statement.name.text);
    }
  const centralSymbol = (node: ts.Node) => {
    let symbol = checker.getSymbolAtLocation(node);
    if (symbol?.flags && symbol.flags & ts.SymbolFlags.Alias)
      symbol = checker.getAliasedSymbol(symbol);
    if (!symbol) return;
    const centralDeclaration = (value: ts.Symbol) =>
      value.declarations?.some(
        (declaration) =>
          resolve(declaration.getSourceFile().fileName) === central
      );
    if (!centralDeclaration(symbol)) {
      if (
        !(symbol.flags & ts.SymbolFlags.Module) ||
        !checker
          .getExportsOfModule(symbol)
          .some((value) =>
            centralDeclaration(
              value.flags & ts.SymbolFlags.Alias
                ? checker.getAliasedSymbol(value)
                : value
            )
          )
      )
        return;
    }
    return symbol;
  };
  for (const file of program.getSourceFiles()) {
    const path = resolve(file.fileName);
    if (!path.startsWith(sourceRoot + sep)) continue;
    const visit = (node: ts.Node) => {
      if (
        (ts.isAsExpression(node) || ts.isTypeAssertionExpression(node)) &&
        !constantAssertion(node)
      ) {
        if (resolve(path) !== central)
          throw new Error(
            'Unapproved assertion outside central exception module: ' +
              relative(sourceRoot, path)
          );
        const name = enclosingFunction(node),
          count = assertions.get(name);
        if (count === undefined)
          throw new Error('Unapproved central assertion helper: ' + name);
        assertions.set(name, count + 1);
      }
      if (
        resolve(path) !== central &&
        (ts.isIdentifier(node) || ts.isStringLiteralLike(node))
      ) {
        const symbol = centralSymbol(node);
        if (
          symbol?.declarations?.some(ts.isSourceFile) &&
          !importOrTypeReference(node) &&
          !(
            ts.isExportDeclaration(node.parent) &&
            node.parent.exportClause &&
            ts.isNamedExports(node.parent.exportClause)
          )
        ) {
          const access = node.parent;
          const member =
            ts.isPropertyAccessExpression(access) && access.expression === node
              ? access.name.text
              : ts.isElementAccessExpression(access) &&
                  access.expression === node &&
                  ts.isStringLiteralLike(access.argumentExpression)
                ? access.argumentExpression.text
                : undefined;
          if (
            !member ||
            !helpers.has(member) ||
            !ts.isCallExpression(access.parent) ||
            access.parent.expression !== access
          )
            throw new Error(
              'Exception namespace may only invoke approved helpers directly'
            );
        }
        const helper = symbol && helpers.get(symbol.name);
        if (helper && ts.isExportSpecifier(node.parent)) {
          if (!seenExports.has(node.parent)) {
            seenExports.add(node.parent);
            const list = reexports.get(helper);
            if (!list) throw new Error('Unknown exception reexport: ' + helper);
            list.push(
              relative(sourceRoot, path).split('\\').join('/') +
                ':' +
                node.parent.name.text
            );
          }
        } else if (helper && !importOrTypeReference(node)) {
          let expression: ts.Node = node;
          if (
            ts.isPropertyAccessExpression(expression.parent) &&
            expression.parent.name === expression
          )
            expression = expression.parent;
          if (
            ts.isElementAccessExpression(expression.parent) &&
            expression.parent.argumentExpression === expression
          )
            expression = expression.parent;
          while (ts.isParenthesizedExpression(expression.parent))
            expression = expression.parent;
          if (
            !ts.isCallExpression(expression.parent) ||
            expression.parent.expression !== expression
          )
            throw new Error(
              'Exception helper may only be directly invoked at approved callsites: ' +
                helper
            );
          const list = calls.get(helper);
          if (!list) throw new Error('Unknown exception helper: ' + helper);
          if (helper === 'invokeDOMConversionWithNode') {
            const call = expression.parent;
            if (
              ts.isVariableDeclaration(call.parent) &&
              call.parent.initializer === call
            )
              callForms.push('variable-initializer');
            else if (
              ts.isArrowFunction(call.parent) &&
              call.parent.body === call &&
              ts.isReturnStatement(call.parent.parent) &&
              call.parent.parent.expression === call.parent
            )
              callForms.push('returned-arrow-body');
            else callForms.push('unapproved');
          }
          list.push(
            relative(sourceRoot, path).split('\\').join('/') +
              ':' +
              enclosingFunction(node)
          );
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(file);
  }
  for (const entry of boundedFunctions) {
    if (manifest.runtimeGuards.some((guard) => guard.helper === entry.helper))
      continue;
    if (assertions.get(entry.helper) !== 1)
      throw new Error(
        'Each approved helper must contain exactly one assertion: ' +
          entry.helper
      );
  }
  for (const entry of boundedFunctions) {
    const exported = reexports.get(entry.helper) ?? [];
    if (
      [...exported].sort().join('\n') !== [...entry.reexports].sort().join('\n')
    )
      throw new Error(
        'Exception reexports differ from manifest for ' +
          entry.helper +
          ': ' +
          JSON.stringify(exported)
      );
    const actual = calls.get(entry.helper) ?? [];
    if ([...actual].sort().join('\n') !== [...entry.calls].sort().join('\n'))
      throw new Error(
        'Exception callsites differ from manifest for ' +
          entry.helper +
          ': ' +
          JSON.stringify(actual)
      );
  }
  if (callForms.sort().join() !== domInvocation.callForms.slice().sort().join())
    throw new Error('DOM invocation call forms differ from manifest');
  return {
    sha256: hash,
    typeOnlyException,
    calls: Object.fromEntries(calls),
    reexports: Object.fromEntries(reexports),
    assertions: Object.fromEntries(assertions),
    domInvocationCallForms: callForms,
    runtimeGuards: manifest.runtimeGuards.map((guard) => ({
      helper: guard.helper,
      kind: guard.kind,
      body: 'return value instanceof klass;',
    })),
  };
}
