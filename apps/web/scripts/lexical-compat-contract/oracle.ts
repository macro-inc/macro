import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import ts from 'typescript';
import { compareExports, typeWitnesses } from './export-types';
import { rejectUntypedExports } from './untyped';
import { approvedWildcardAny } from './wildcard-types';
import { declarationOptions, declarationSpecifier } from './resolution';

export interface RemovedPrivate {
  file: string;
  className: string;
  member: string;
}

function memberName(
  name: ts.PropertyName | ts.BindingName | undefined,
  source: ts.SourceFile
) {
  if (!name) return '<unnamed>';
  return ts.isIdentifier(name) ||
    ts.isStringLiteralLike(name) ||
    ts.isPrivateIdentifier(name)
    ? name.text
    : name.getText(source);
}
function uniqueSymbol(type: ts.Type): type is ts.UniqueESSymbolType {
  return (type.flags & ts.TypeFlags.UniqueESSymbol) !== 0;
}
/** Test-only AST projection: no signature reconstruction or function inference. */
export function projectDeclaration(file: ts.SourceFile) {
  const removed: RemovedPrivate[] = [];
  const transformed = ts.transform(file, [
    (context) => {
      const visit: ts.Visitor = (node) => {
        if (ts.isClassDeclaration(node) || ts.isClassExpression(node)) {
          const members = node.members.filter((member) => {
            const modifiers = ts.canHaveModifiers(member)
              ? ts.getModifiers(member)
              : undefined;
            const privateMember =
              modifiers?.some(
                (modifier) => modifier.kind === ts.SyntaxKind.PrivateKeyword
              ) ||
              (member.name && ts.isPrivateIdentifier(member.name));
            if (!privateMember || ts.isConstructorDeclaration(member))
              return true;
            removed.push({
              file: file.fileName,
              className: node.name?.text ?? '<anonymous>',
              member: memberName(member.name, file),
            });
            return false;
          });
          if (ts.isClassDeclaration(node))
            return ts.factory.updateClassDeclaration(
              node,
              node.modifiers,
              node.name,
              node.typeParameters,
              node.heritageClauses,
              members
            );
          return ts.factory.updateClassExpression(
            node,
            node.modifiers,
            node.name,
            node.typeParameters,
            node.heritageClauses,
            members
          );
        }
        return ts.visitEachChild(node, visit, context);
      };
      return (root) => ts.visitNode(root, visit, ts.isSourceFile) ?? root;
    },
  ]);
  const projected = transformed.transformed[0];
  const text = ts
    .createPrinter({ newLine: ts.NewLineKind.LineFeed })
    .printFile(projected);
  transformed.dispose();
  return { text, removed };
}

export const COMPILER_OPTIONS: ts.CompilerOptions = {
  strict: true,
  noEmit: true,
  skipLibCheck: false,
  target: ts.ScriptTarget.ESNext,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  lib: ['lib.esnext.d.ts', 'lib.dom.d.ts', 'lib.dom.iterable.d.ts'],
  types: [],
  allowImportingTsExtensions: true,
  jsx: ts.JsxEmit.Preserve,
  jsxImportSource: 'solid-js',
};

export function diagnosticsText(diagnostics: readonly ts.Diagnostic[]) {
  return ts.formatDiagnosticsWithColorAndContext(diagnostics, {
    getCanonicalFileName: (name) => name,
    getCurrentDirectory: () => process.cwd(),
    getNewLine: () => '\n',
  });
}

/** Check the original recursive declaration graph through a projected compiler host. */
export function checkDeclarations(options: {
  roots: string[];
  projected: (path: string) => boolean;
  compilerOptions?: ts.CompilerOptions;
  artifactDirectory?: string;
  declarations?: ReadonlyMap<string, string>;
  callerRoots?: string[];
  rejectAny?: (path: string) => boolean;
  wildcardSource?: string;
  resolutionBase?: string;
  classContracts?: {
    expectedModule: string;
    actualModule: string;
    names: string[];
  }[];
  namespaceContracts?: { expectedModule: string; actualModule: string }[];
}) {
  const compilerOptions = { ...COMPILER_OPTIONS, ...options.compilerOptions };
  const moduleHost = ts.createCompilerHost(compilerOptions);
  const originalSources = new Map(
    [...(options.declarations ?? [])].map(([source, declaration]) => [
      resolve(declaration),
      source,
    ])
  );
  const resolver =
    (
      projectSources: boolean
    ): NonNullable<ts.CompilerHost['resolveModuleNameLiterals']> =>
    (modules, containingFile) =>
      modules.map((module) => {
        const specifier = declarationSpecifier(module.text);
        const originalContaining =
          originalSources.get(resolve(containingFile)) ?? containingFile;
        const lexicalImport =
          specifier === 'lexical' || specifier.startsWith('@lexical/');
        const resolutionOptions = declarationOptions(
          module.text,
          originalContaining,
          compilerOptions
        );
        let resolution = ts.resolveModuleName(
          specifier,
          lexicalImport
            ? (options.resolutionBase ?? originalContaining)
            : originalContaining,
          resolutionOptions,
          moduleHost
        );
        if (!resolution.resolvedModule && options.resolutionBase)
          resolution = ts.resolveModuleName(
            specifier,
            options.resolutionBase,
            resolutionOptions,
            moduleHost
          );
        const resolvedModule = resolution.resolvedModule;
        const declaration =
          resolvedModule &&
          options.declarations?.get(resolve(resolvedModule.resolvedFileName));
        return {
          ...resolution,
          resolvedModule:
            declaration &&
            (projectSources || /\.d\.[cm]?ts$/.test(containingFile))
              ? {
                  ...resolvedModule,
                  resolvedFileName: declaration,
                  extension: ts.Extension.Dts,
                }
              : resolvedModule,
        };
      });
  moduleHost.resolveModuleNameLiterals = resolver(false);
  const original = ts.createProgram(
    [...options.roots, ...(options.callerRoots ?? [])],
    compilerOptions,
    moduleHost
  );
  const checker = original.getTypeChecker();
  const canonical = (path: string) =>
    originalSources.get(resolve(path)) ?? resolve(path);
  const memberIdentity = (declaration: ts.Declaration) => {
    if (
      !(ts.isClassElement(declaration) || ts.isParameter(declaration)) ||
      !declaration.name
    )
      return;
    let owner: ts.Node | undefined = declaration.parent;
    while (
      owner &&
      !(ts.isClassDeclaration(owner) || ts.isClassExpression(owner))
    )
      owner = owner.parent;
    if (
      !owner ||
      !(ts.isClassDeclaration(owner) || ts.isClassExpression(owner))
    )
      return;
    const member =
      ts.isIdentifier(declaration.name) ||
      ts.isStringLiteralLike(declaration.name) ||
      ts.isPrivateIdentifier(declaration.name)
        ? declaration.name.text
        : declaration.name.getText();
    return JSON.stringify([
      canonical(declaration.getSourceFile().fileName),
      owner.name?.text ?? '<anonymous>',
      member,
    ]);
  };
  const candidates = new Map<string, RemovedPrivate>();
  for (const file of original.getSourceFiles()) {
    if (!file.isDeclarationFile || !options.projected(file.fileName)) continue;
    const visit = (node: ts.Node) => {
      if (ts.isClassDeclaration(node) || ts.isClassExpression(node)) {
        for (const member of node.members) {
          const modifiers = ts.canHaveModifiers(member)
            ? ts.getModifiers(member)
            : undefined;
          if (
            ts.isConstructorDeclaration(member) ||
            !member.name ||
            !modifiers?.some(
              (modifier) => modifier.kind === ts.SyntaxKind.PrivateKeyword
            )
          )
            continue;
          const identity = memberIdentity(member);
          if (!identity) continue;
          candidates.set(identity, {
            file: file.fileName,
            className: node.name?.text ?? '<anonymous>',
            member: memberName(member.name, file),
          });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(file);
  }
  // Indexed private access is legal TypeScript: never silently erase such a use.
  const reachable: RemovedPrivate[] = [];
  const privateNames = new Set(
    [...candidates.values()].map((candidate) => candidate.member)
  );
  for (const file of original.getSourceFiles()) {
    const record = (symbol: ts.Symbol | undefined) => {
      if (!symbol) return;
      for (const declaration of symbol.declarations ?? []) {
        const identity = memberIdentity(declaration);
        const candidate = identity && candidates.get(identity);
        if (candidate && canonical(candidate.file) !== canonical(file.fileName))
          reachable.push(candidate);
      }
    };
    const visit = (node: ts.Node) => {
      if (
        ts.isPropertyAccessExpression(node) &&
        privateNames.has(node.name.text)
      )
        record(checker.getSymbolAtLocation(node.name));
      const indexTypes = (index: ts.Node) => {
        const type = checker.getTypeAtLocation(index);
        const constraint = checker.getBaseConstraintOfType(type) ?? type;
        return constraint.isUnion() ? constraint.types : [constraint];
      };
      const indexKeys = (types: readonly ts.Type[]) =>
        types
          .flatMap((type) =>
            type.isStringLiteral()
              ? [type.value]
              : type.isNumberLiteral()
                ? [String(type.value)]
                : []
          )
          .filter((key) => privateNames.has(key));
      const inspect = (object: ts.Node, index: ts.Node) => {
        const types = indexTypes(index);
        const keys = indexKeys(types);
        const symbols = types.filter(uniqueSymbol);
        const broad = types.some(
          (type) => (type.flags & ts.TypeFlags.String) !== 0
        );
        if (!keys.length && !symbols.length && !broad) return;
        const receiver = checker.getTypeAtLocation(object);
        for (const key of keys)
          record(checker.getPropertyOfType(receiver, key));
        for (const symbol of symbols)
          record(
            receiver
              .getProperties()
              .find((property) => property.escapedName === symbol.escapedName)
          );
        if (broad && checker.getIndexTypeOfType(receiver, ts.IndexKind.String))
          for (const name of privateNames)
            record(checker.getPropertyOfType(receiver, name));
      };
      if (ts.isElementAccessExpression(node))
        inspect(node.expression, node.argumentExpression);
      if (ts.isIndexedAccessTypeNode(node))
        inspect(node.objectType, node.indexType);
      ts.forEachChild(node, visit);
    };
    visit(file);
  }
  if (reachable.length)
    throw new Error(
      'Cannot strip externally reachable private members: ' +
        JSON.stringify(reachable)
    );
  const host = ts.createCompilerHost(compilerOptions);
  host.resolveModuleNameLiterals = resolver(true);
  const readSource = host.getSourceFile.bind(host);
  const manifest: {
    file: string;
    originalSha256: string;
    projectedSha256: string;
    removed: RemovedPrivate[];
  }[] = [];
  host.getSourceFile = (path, languageVersion, onError, createNew) => {
    const source = readSource(path, languageVersion, onError, createNew);
    if (!source || !source.isDeclarationFile || !options.projected(path))
      return source;
    const projection = projectDeclaration(source);
    if (options.rejectAny?.(path)) {
      const reject = (node: ts.Node) => {
        if (
          node.kind === ts.SyntaxKind.AnyKeyword &&
          !(
            options.wildcardSource &&
            originalSources.get(resolve(path)) ===
              resolve(options.wildcardSource) &&
            approvedWildcardAny(node)
          )
        )
          throw new Error('Untyped public declaration in ' + path);
        ts.forEachChild(node, reject);
      };
      reject(
        ts.createSourceFile(path, projection.text, source.languageVersion, true)
      );
    }
    const hash = (text: string) =>
      createHash('sha256').update(text).digest('hex');
    manifest.push({
      file: path,
      originalSha256: hash(source.text),
      projectedSha256: hash(projection.text),
      removed: projection.removed,
    });
    if (options.artifactDirectory) {
      const destination = join(
        options.artifactDirectory,
        'declarations',
        hash(path) + '.d.ts'
      );
      mkdirSync(join(options.artifactDirectory, 'declarations'), {
        recursive: true,
      });
      writeFileSync(destination, projection.text);
    }
    return ts.createSourceFile(
      path,
      projection.text +
        (options.namespaceContracts ? '\n' + typeWitnesses(source) : ''),
      source.languageVersion,
      true,
      ts.ScriptKind.TS
    );
  };
  const program = ts.createProgram(options.roots, compilerOptions, host);
  const diagnostics = [...ts.getPreEmitDiagnostics(program)];
  const observedClasses: {
    name: string;
    constructorAndStatics: boolean;
    publicMembers: string[];
  }[] = [];
  const projectedChecker = program.getTypeChecker();
  const moduleSymbol = (specifier: string) => {
    let symbol: ts.Symbol | undefined;
    for (const path of options.roots) {
      const file = program.getSourceFile(path);
      if (!file) continue;
      const visit = (node: ts.Node) => {
        if (
          ts.isImportDeclaration(node) &&
          ts.isStringLiteralLike(node.moduleSpecifier) &&
          node.moduleSpecifier.text === specifier
        )
          symbol = projectedChecker.getSymbolAtLocation(node.moduleSpecifier);
        if (
          ts.isImportTypeNode(node) &&
          ts.isLiteralTypeNode(node.argument) &&
          ts.isStringLiteralLike(node.argument.literal) &&
          node.argument.literal.text === specifier
        )
          symbol = projectedChecker.getSymbolAtLocation(node.argument.literal);
        ts.forEachChild(node, visit);
      };
      visit(file);
    }
    return symbol;
  };
  const classSymbol = (module: ts.Symbol | undefined, name: string) => {
    if (!module) return;
    let exported = projectedChecker
      .getExportsOfModule(module)
      .find((symbol) => symbol.name === name);
    if (!exported) return;
    if (exported.flags & ts.SymbolFlags.Alias)
      exported = projectedChecker.getAliasedSymbol(exported);
    const type = projectedChecker.getDeclaredTypeOfSymbol(exported);
    const symbol = type.getSymbol() ?? exported;
    const declaration = symbol.declarations?.find(ts.isClassDeclaration);
    return declaration ? { symbol, declaration, type } : undefined;
  };
  for (const pair of options.classContracts ?? []) {
    const expected = moduleSymbol(pair.expectedModule),
      actual = moduleSymbol(pair.actualModule);
    for (const name of pair.names) {
      const upstream = classSymbol(expected, name),
        compat = classSymbol(actual, name);
      const matches = !!(
        upstream &&
        compat &&
        projectedChecker.isTypeAssignableTo(
          projectedChecker.getTypeOfSymbolAtLocation(
            compat.symbol,
            compat.declaration
          ),
          projectedChecker.getTypeOfSymbolAtLocation(
            upstream.symbol,
            upstream.declaration
          )
        )
      );
      observedClasses.push({
        name,
        constructorAndStatics: matches,
        publicMembers:
          upstream?.type.getProperties().map((symbol) => symbol.name) ?? [],
      });
      if (!matches)
        diagnostics.push({
          category: ts.DiagnosticCategory.Error,
          code: 95001,
          file: undefined,
          start: undefined,
          length: undefined,
          messageText:
            'Observable class constructor/statics/prototype mismatch: ' + name,
        });
    }
  }
  const namespaceCoverage: {
    module: string;
    exports: string[];
    failures: string[];
  }[] = [];
  for (const pair of options.namespaceContracts ?? []) {
    const expected = moduleSymbol(pair.expectedModule),
      actual = moduleSymbol(pair.actualModule);
    const failures =
      expected && actual
        ? compareExports(projectedChecker, expected, actual)
        : ['Missing module for export contract: ' + pair.actualModule];
    if (actual && expected && options.rejectAny)
      failures.push(
        ...rejectUntypedExports(
          projectedChecker,
          actual,
          options.rejectAny,
          expected
        )
      );
    namespaceCoverage.push({
      module: pair.expectedModule,
      exports: expected
        ? projectedChecker
            .getExportsOfModule(expected)
            .map((symbol) => symbol.name)
            .filter((name) => !name.startsWith('__observable_type_contract_'))
        : [],
      failures,
    });
    for (const failure of failures)
      diagnostics.push({
        category: ts.DiagnosticCategory.Error,
        code: 95002,
        file: undefined,
        start: undefined,
        length: undefined,
        messageText: failure,
      });
  }
  if (options.artifactDirectory) {
    mkdirSync(options.artifactDirectory, { recursive: true });
    writeFileSync(
      join(options.artifactDirectory, 'observable-declarations.json'),
      JSON.stringify(
        {
          typescript: ts.version,
          manifest,
          observedClasses,
          namespaceCoverage,
          diagnostics: diagnostics.map((diagnostic) => ({
            code: diagnostic.code,
            message: ts.flattenDiagnosticMessageText(
              diagnostic.messageText,
              '\n'
            ),
          })),
        },
        null,
        2
      ) + '\n'
    );
  }
  return { diagnostics, manifest };
}
