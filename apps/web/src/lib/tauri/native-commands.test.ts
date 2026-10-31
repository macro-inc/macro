import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import nativeCommands from '../../../native-commands.json';

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const repositoryRoot = resolve(webRoot, '../..');
const tauriRoot = resolve(webRoot, 'tauri');
const SOURCE_ROOTS = ['apps/web/src', 'packages'];
const TAURI_CORE = '@tauri-apps/api/core';
// Stands for a wrapper's command parameter while reading its invoke call.
const PARAMETER = '\u0000';

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      return entry.name === 'node_modules' || entry.name === 'dist'
        ? []
        : sourceFiles(path);
    }
    return /\.tsx?$/.test(entry.name) &&
      !/\.(test|spec)\.tsx?$/.test(entry.name) &&
      !entry.name.endsWith('.d.ts')
      ? [path]
      : [];
  });
}

function walk(node: ts.Node, visit: (node: ts.Node) => void): void {
  visit(node);
  node.forEachChild((child) => walk(child, visit));
}

/** The named functions around `node`, innermost first. */
function enclosingFunctions(
  node: ts.Node
): Array<{ name: string; declaration: ts.SignatureDeclaration }> {
  const functions: Array<{
    name: string;
    declaration: ts.SignatureDeclaration;
  }> = [];
  for (let at = node.parent; at; at = at.parent) {
    if (!ts.isFunctionLike(at)) continue;
    const declared =
      ts.isFunctionDeclaration(at) && at.name
        ? at.name
        : ts.isVariableDeclaration(at.parent)
          ? at.parent.name
          : undefined;
    if (declared && ts.isIdentifier(declared)) {
      functions.push({ name: declared.text, declaration: at });
    }
  }
  return functions;
}

/** String values of a parameter type that is a union of string literals. */
function literalUnionValues(
  type: ts.TypeNode | undefined
): string[] | undefined {
  const members = type && ts.isUnionTypeNode(type) ? type.types : [type];
  const values = members.map((member) =>
    member && ts.isLiteralTypeNode(member) && ts.isStringLiteral(member.literal)
      ? member.literal.text
      : undefined
  );
  return values.every((value) => value !== undefined) ? values : undefined;
}

/** The variable named `name` declared directly in a block or file. */
function localDeclaration(
  container: ts.Node,
  name: string
): ts.VariableDeclaration | undefined {
  if (!ts.isSourceFile(container) && !ts.isBlock(container)) return undefined;
  for (const statement of container.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    const declaration = statement.declarationList.declarations.find(
      (d) => ts.isIdentifier(d.name) && d.name.text === name
    );
    if (declaration) return declaration;
  }
  return undefined;
}

/**
 * Values of the binding an identifier refers to, found by scope: a `const`
 * string, a parameter typed as a literal union, or the command parameter of
 * the wrapper being read. Anything else, a `let` included, is unreadable.
 */
function bindingValues(
  name: ts.Identifier,
  wrapper?: ts.SignatureDeclaration
): string[] | undefined {
  for (let at = name.parent; at; at = at.parent) {
    if (ts.isFunctionLike(at)) {
      const parameter = at.parameters.find(
        (p) => ts.isIdentifier(p.name) && p.name.text === name.text
      );
      if (parameter) {
        return at === wrapper && parameter === at.parameters[0]
          ? [PARAMETER]
          : literalUnionValues(parameter.type);
      }
    }
    const declaration = localDeclaration(at, name.text);
    if (declaration) {
      const constant =
        ts.isVariableDeclarationList(declaration.parent) &&
        (declaration.parent.flags & ts.NodeFlags.Const) !== 0;
      return constant &&
        declaration.initializer &&
        ts.isStringLiteralLike(declaration.initializer)
        ? [declaration.initializer.text]
        : undefined;
    }
  }
  return undefined;
}

/**
 * Every value a command expression can have, or undefined when it is computed
 * from something this scan cannot read. Reads string literals, conditionals,
 * templates, and the bindings `bindingValues` reads.
 */
function commandValues(
  node: ts.Expression,
  wrapper?: ts.SignatureDeclaration
): string[] | undefined {
  if (ts.isStringLiteralLike(node)) return [node.text];
  if (ts.isParenthesizedExpression(node)) {
    return commandValues(node.expression, wrapper);
  }
  if (ts.isConditionalExpression(node)) {
    const whenTrue = commandValues(node.whenTrue, wrapper);
    const whenFalse = commandValues(node.whenFalse, wrapper);
    return whenTrue && whenFalse ? [...whenTrue, ...whenFalse] : undefined;
  }
  if (ts.isIdentifier(node)) return bindingValues(node, wrapper);
  if (ts.isTemplateExpression(node)) {
    let values = [node.head.text];
    for (const span of node.templateSpans) {
      const parts = commandValues(span.expression, wrapper);
      if (!parts) return undefined;
      values = values.flatMap((value) =>
        parts.map((part) => value + part + span.literal.text)
      );
    }
    return values;
  }
  return undefined;
}

type NamedCall = {
  call: ts.CallExpression;
  callee: string;
  command: ts.Expression;
};
type TauriImports = { invokes: Set<string>; pluginListeners: Set<string> };

/** Local names a file gives `invoke` and `addPluginListener`. */
function tauriImports(source: ts.SourceFile): TauriImports {
  const imports: TauriImports = {
    invokes: new Set(),
    pluginListeners: new Set(),
  };
  for (const statement of source.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      statement.moduleSpecifier.text !== TAURI_CORE
    ) {
      continue;
    }
    const bindings = statement.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    for (const element of bindings.elements) {
      const imported = (element.propertyName ?? element.name).text;
      if (imported === 'invoke') imports.invokes.add(element.name.text);
      if (imported === 'addPluginListener') {
        imports.pluginListeners.add(element.name.text);
      }
    }
  }
  return imports;
}

/** Calls of a plain name with at least one argument. */
function namedCalls(source: ts.SourceFile): NamedCall[] {
  const calls: NamedCall[] = [];
  walk(source, (node) => {
    const [command] = ts.isCallExpression(node) ? node.arguments : [];
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      command
    ) {
      calls.push({ call: node, callee: node.expression.text, command });
    }
  });
  return calls;
}

/**
 * Functions that pass their first parameter to `invoke` (the cache host's
 * `request`), with the commands they build from it, and those invoke calls.
 */
function findWrappers(calls: NamedCall[], invokes: Set<string>) {
  const wrappers = new Map<string, string[]>();
  const wrapped = new Set<ts.CallExpression>();
  for (const { call, callee, command } of calls) {
    if (!invokes.has(callee) || commandValues(command)) continue;
    for (const wrapper of enclosingFunctions(call)) {
      const shapes = commandValues(command, wrapper.declaration);
      if (!shapes?.every((shape) => shape.includes(PARAMETER))) continue;
      wrappers.set(wrapper.name, shapes);
      wrapped.add(call);
      break;
    }
  }
  return { wrappers, wrapped };
}

/**
 * The native commands one call names: none for a call that is not IPC, or
 * undefined when it is IPC and its command cannot be read.
 */
function callCommands(
  { callee, command }: NamedCall,
  imports: TauriImports,
  wrappers: Map<string, string[]>
): string[] | undefined {
  if (imports.pluginListeners.has(callee)) {
    return commandValues(command)?.map(
      (plugin) => `plugin:${plugin}|register_listener`
    );
  }
  const shapes = imports.invokes.has(callee)
    ? [PARAMETER]
    : wrappers.get(callee);
  if (!shapes) return [];
  const values = commandValues(command);
  return values?.flatMap((value) =>
    shapes.map((shape) => shape.replace(PARAMETER, value))
  );
}

/**
 * Every native command the shipped web code calls, by the file calling it,
 * and the calls whose command this scan cannot read. A function that passes
 * its first parameter to `invoke` is a wrapper, and its callers name the
 * command.
 */
function scanInvokedCommands(): {
  commands: Map<string, string>;
  unreadable: string[];
} {
  const commands = new Map<string, string>();
  const unreadable: string[] = [];
  for (const root of SOURCE_ROOTS) {
    for (const file of sourceFiles(resolve(repositoryRoot, root))) {
      const text = readFileSync(file, 'utf8');
      if (!text.includes(TAURI_CORE)) continue;
      const source = ts.createSourceFile(
        file,
        text,
        ts.ScriptTarget.Latest,
        true
      );
      const path = relative(repositoryRoot, file);
      const imports = tauriImports(source);
      const calls = namedCalls(source);
      const { wrappers, wrapped } = findWrappers(calls, imports.invokes);
      for (const named of calls) {
        if (wrapped.has(named.call)) continue;
        const names = callCommands(named, imports, wrappers);
        if (!names) {
          const { line } = source.getLineAndCharacterOfPosition(
            named.call.getStart()
          );
          unreadable.push(
            `${path}:${line + 1} ${named.call.getText().split('\n')[0]}`
          );
          continue;
        }
        for (const name of names)
          if (!commands.has(name)) commands.set(name, path);
      }
    }
  }
  return { commands, unreadable };
}

/** Commands the app registers itself, in `generate_handler!`. */
function appCommands(): Set<string> {
  const lib = readFileSync(resolve(tauriRoot, 'src-tauri/src/lib.rs'), 'utf8');
  const handler =
    /\.invoke_handler\(tauri::generate_handler!\[([\s\S]*?)\]\)/.exec(lib)?.[1];
  if (!handler) throw new Error('generate_handler! not found in lib.rs');
  return new Set(
    handler
      .split(',')
      .map((entry) => entry.replace(/#\[[^\]]*\]/g, '').trim())
      .filter(Boolean)
      .map((path) => path.split('::').at(-1) ?? path)
  );
}

/** Commands of the in-repo plugins, by plugin name, from their `build.rs`. */
function repoPluginCommands(): Map<string, Set<string>> {
  const plugins = new Map<string, Set<string>>();
  for (const entry of readdirSync(tauriRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    let lib: string;
    let build: string;
    try {
      lib = readFileSync(resolve(tauriRoot, entry.name, 'src/lib.rs'), 'utf8');
      build = readFileSync(resolve(tauriRoot, entry.name, 'build.rs'), 'utf8');
    } catch {
      continue;
    }
    const name = /Builder::new\("([a-z0-9-]+)"\)/.exec(lib)?.[1];
    if (!name) continue;
    plugins.set(
      name,
      new Set([...build.matchAll(/"([A-Za-z0-9_]+)"/g)].map((m) => m[1] ?? ''))
    );
  }
  return plugins;
}

describe('native commands', () => {
  const { commands: invoked, unreadable } = scanInvokedCommands();

  it('names every native command with a value this test can read', () => {
    // Pass the command as a string literal, a constant, or a parameter typed
    // as a union of literals, so the checks below can see it.
    expect(unreadable).toEqual([]);
  });

  it('lists every command the web bundle calls in native-commands.json', () => {
    // An over-the-air bundle can reach native builds older than the command.
    // Before adding one here, raise min-native-build.json to the first build
    // with it, or handle `Command … not found` (see apps/web/AGENTS.md).
    expect([...invoked.keys()].sort()).toEqual(nativeCommands.commands);
    expect(nativeCommands.commands.length).toBeGreaterThan(50);
  });

  it('calls only commands the native app registers', () => {
    const app = appCommands();
    const plugins = repoPluginCommands();
    const lib = readFileSync(
      resolve(tauriRoot, 'src-tauri/src/lib.rs'),
      'utf8'
    );
    const unregistered = [...invoked].flatMap(([command, file]) => {
      const plugin = /^plugin:([a-z0-9-]+)\|([A-Za-z0-9_]+)$/.exec(command);
      if (!plugin) return app.has(command) ? [] : [`${command} (${file})`];
      const [, name = '', pluginCommand = ''] = plugin;
      const repoPlugin = plugins.get(name);
      if (repoPlugin) {
        return repoPlugin.has(pluginCommand) ? [] : [`${command} (${file})`];
      }
      // A published plugin: the app must at least install it.
      return lib.includes(`tauri_plugin_${name.replaceAll('-', '_')}::`)
        ? []
        : [`${command} (${file})`];
    });
    expect(unregistered).toEqual([]);
  });
});
