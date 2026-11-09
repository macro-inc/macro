import path from 'node:path';
import ts from 'typescript';

export interface Source {
  readonly path: string;
  readonly text: string;
}
interface Method {
  readonly name: string;
  readonly static: boolean;
  readonly location: string;
}
interface NodeClass {
  readonly name: string;
  readonly declaration: ts.ClassDeclaration;
  readonly parent: ts.Expression | undefined;
  readonly methods: readonly Method[];
}
export interface HookEvidence {
  readonly name: string;
  readonly static: boolean;
  readonly calls: readonly string[];
  readonly overrides: readonly string[];
}

const bases = new Set([
  'LexicalNode',
  'ElementNode',
  'TextNode',
  'DecoratorNode',
]);
// S2 VIEW: these methods belong to the shared production view layer.
const view = new Set([
  'createDOM',
  'updateDOM',
  'exportDOM',
  'importDOM',
  'decorate',
  'getDOMSlot',
  'reconcileObservedMutation',
]);
// These configure the registry or allocate/copy a record. They are not virtual
// node operations; afterCloneFrom/importJSON supply the model lifecycle hooks.
const registry = new Set(['getType', 'clone', '$config', 'config']);
// RootNode supplies an invariant here, rather than a package extension point.
// S1's non-hook getTopLevelElement and this throwing form share native traversal.
const native = new Set(['getTopLevelElementOrThrow']);
// S4 §2.4 / S1 D-C3: these overrides deliberately retain native behavior.
export const nonHooks = [
  'isSimpleText',
  'splitText',
  'mergeWithSibling',
  'select',
  'selectStart',
  'selectEnd',
  'selectNext',
  'selectPrevious',
  'getTopLevelElement',
  'getTextContentSize',
  'isSegmented',
  'isToken',
  'isUnmergeable',
] as const;
const nonHookNames: ReadonlySet<string> = new Set(nonHooks);
// S4 §2.4 explicitly reserves these extension points even though the pinned
// package classes do not override them. Each must have a base and a caller.
const extensionPoints = [
  'isKeyboardSelectable',
  'selectionTransform',
  'transform',
];

/** Scan the pinned sources independently of the Rust hook names. */
export function inventoryHooks(sources: readonly Source[]): HookEvidence[] {
  const classes: NodeClass[] = [];
  const invocations: {
    member: ts.PropertyAccessExpression;
    location: string;
  }[] = [];
  const files = new Map(
    sources
      .filter(
        (input) =>
          input.path.includes('/src/') && !input.path.includes('/__tests__/')
      )
      .map((input) => [
        path.resolve('/', input.path),
        ts.createSourceFile(
          path.resolve('/', input.path),
          input.text,
          ts.ScriptTarget.Latest,
          true
        ),
      ])
  );
  const options: ts.CompilerOptions = {
    lib: ['lib.es2023.d.ts'],
    types: [],
    target: ts.ScriptTarget.Latest,
  };
  const host = ts.createCompilerHost(options);
  const library = path.dirname(ts.getDefaultLibFilePath(options)) + path.sep;
  const readLibrary = host.getSourceFile.bind(host);
  host.fileExists = (file) =>
    files.has(file) || (file.startsWith(library) && ts.sys.fileExists(file));
  host.readFile = (file) =>
    files.get(file)?.text ??
    (file.startsWith(library) ? ts.sys.readFile(file) : undefined);
  host.getSourceFile = (file, version) =>
    files.get(file) ??
    (file.startsWith(library) ? readLibrary(file, version) : undefined);
  // Resolve only the supplied pinned sources. No npm declarations or unrelated
  // local checkout can affect which node class an alias refers to.
  host.resolveModuleNames = (names, containing) =>
    names.map((name) => {
      let stem: string;
      if (name.startsWith('.'))
        stem = path.resolve(path.dirname(containing), name);
      else if (name === 'lexical') stem = '/packages/lexical/src/index';
      else if (name.startsWith('@lexical/')) {
        const [packageName, ...rest] = name
          .slice('@lexical/'.length)
          .split('/');
        stem = `/packages/lexical-${packageName}/src/${rest.join('/') || 'index'}`;
      } else return undefined;
      for (const suffix of ['.ts', '.tsx', '/index.ts', '/index.tsx']) {
        const file = stem + suffix;
        if (files.has(file)) return { resolvedFileName: file };
      }
      return undefined;
    });
  const checker = ts
    .createProgram([...files.keys()], options, host)
    .getTypeChecker();
  for (const source of files.values()) {
    const input = { path: path.relative('/', source.fileName) };
    const location = (node: ts.Node) =>
      `${input.path}:${source.getLineAndCharacterOfPosition(node.getStart()).line + 1}`;
    function visit(node: ts.Node): void {
      if (ts.isClassDeclaration(node) && node.name !== undefined) {
        const parent = node.heritageClauses
          ?.filter((clause) => clause.token === ts.SyntaxKind.ExtendsKeyword)
          .flatMap((clause) => clause.types)[0]?.expression;
        classes.push({
          name: node.name.text,
          declaration: node,
          parent,
          methods: node.members
            .filter(ts.isMethodDeclaration)
            .flatMap((method) => {
              if (!ts.isIdentifier(method.name) || method.body === undefined)
                return [];
              return [
                {
                  name: method.name.text,
                  static:
                    method.modifiers?.some(
                      (modifier) =>
                        modifier.kind === ts.SyntaxKind.StaticKeyword
                    ) ?? false,
                  location: location(method),
                },
              ];
            }),
        });
      }
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression)
      ) {
        if (node.expression.expression.kind !== ts.SyntaxKind.SuperKeyword)
          invocations.push({
            member: node.expression,
            location: location(node),
          });
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
  }

  const declarations = new Map(classes.map((node) => [node.declaration, node]));
  function nearest(
    node: NodeClass,
    seen = new Set<NodeClass>()
  ): string | undefined {
    if (bases.has(node.name)) return node.name;
    if (seen.has(node)) throw new Error(`cyclic node ancestry: ${node.name}`);
    seen.add(node);
    if (node.parent === undefined) return undefined;
    let symbol = checker.getSymbolAtLocation(node.parent);
    if (symbol !== undefined && symbol.flags & ts.SymbolFlags.Alias)
      symbol = checker.getAliasedSymbol(symbol);
    const declaration = symbol?.valueDeclaration;
    if (declaration === undefined || !ts.isClassDeclaration(declaration))
      return undefined;
    const parent = declarations.get(declaration);
    return parent === undefined ? undefined : nearest(parent, seen);
  }
  function baseMethod(
    base: string,
    method: Pick<Method, 'name' | 'static'>
  ): Method | undefined {
    const declarations = classes.filter((node) => node.name === base);
    if (declarations.length !== 1)
      throw new Error(`expected one base class: ${base}`);
    return (
      declarations[0].methods.find(
        (member) =>
          member.name === method.name && member.static === method.static
      ) ??
      (base === 'LexicalNode' ? undefined : baseMethod('LexicalNode', method))
    );
  }
  for (const base of bases) {
    if (classes.filter((node) => node.name === base).length !== 1)
      throw new Error(`expected one base class: ${base}`);
  }
  function methodKey(name: string, isStatic: boolean): string {
    return `${isStatic ? 'static' : 'instance'}:${name}`;
  }
  function collectCalls(): Map<string, string[]> {
    const calls = new Map<string, string[]>();
    for (const invocation of invocations) {
      const symbol = checker.getSymbolAtLocation(invocation.member.name);
      for (const declaration of symbol?.declarations ?? []) {
        if (
          !ts.isMethodDeclaration(declaration) ||
          !ts.isClassDeclaration(declaration.parent)
        )
          continue;
        const node = declarations.get(declaration.parent);
        const base = node === undefined ? undefined : nearest(node);
        if (base === undefined) continue;
        const name = invocation.member.name.text;
        const isStatic =
          declaration.modifiers?.some(
            (modifier) => modifier.kind === ts.SyntaxKind.StaticKeyword
          ) ?? false;
        if (baseMethod(base, { name, static: isStatic }) === undefined)
          continue;
        if (
          name === 'getTextContent' &&
          (base === 'ElementNode' || base === 'TextNode')
        )
          continue;
        const key = methodKey(name, isStatic);
        const found = calls.get(key) ?? [];
        found.push(invocation.location);
        calls.set(key, found);
      }
    }
    return calls;
  }
  const calls = collectCalls();
  function collectOverrides(): Map<
    string,
    { static: boolean; overrides: string[] }
  > {
    const observed = new Map<
      string,
      { static: boolean; overrides: string[] }
    >();
    for (const node of classes) {
      if (bases.has(node.name)) continue;
      const base = nearest(node);
      if (base === undefined) continue;
      for (const method of node.methods) {
        if (
          baseMethod(base, method) === undefined ||
          view.has(method.name) ||
          registry.has(method.name)
        )
          continue;
        if (
          nonHookNames.has(method.name) ||
          (method.name === 'getTextContent' && base !== 'DecoratorNode')
        )
          continue;
        if (native.has(method.name)) {
          if (!method.location.startsWith('packages/lexical/src/'))
            throw new Error(
              `unexpected override of native traversal: ${method.location}`
            );
          continue;
        }
        const previous = observed.get(method.name);
        if (previous !== undefined && previous.static !== method.static)
          throw new Error(`static/instance hook collision: ${method.name}`);
        const entry = previous ?? { static: method.static, overrides: [] };
        entry.overrides.push(method.location);
        observed.set(method.name, entry);
      }
    }
    return observed;
  }
  const observed = collectOverrides();
  for (const name of extensionPoints) {
    const method = [...bases]
      .flatMap((base) =>
        classes
          .filter((node) => node.name === base)
          .flatMap((node) => node.methods)
      )
      .find((method) => method.name === name);
    if (method === undefined || !calls.has(methodKey(name, method.static)))
      throw new Error(`missing declared extension point or caller: ${name}`);
    if (!observed.has(name))
      observed.set(name, { static: method.static, overrides: [] });
  }
  return [...observed]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, evidence]) => {
      const sites = [
        ...new Set(calls.get(methodKey(name, evidence.static)) ?? []),
      ].sort();
      // The contract explicitly includes these ListItemNode predicates despite
      // their lack of a non-test callsite in v0.45. Keep their override evidence.
      if (
        sites.length === 0 &&
        name !== 'canInsertAfter' &&
        name !== 'canReplaceWith'
      )
        throw new Error(`hook has no upstream caller: ${name}`);
      return {
        name,
        static: evidence.static,
        calls: sites,
        overrides: [...new Set(evidence.overrides)].sort(),
      };
    });
}
