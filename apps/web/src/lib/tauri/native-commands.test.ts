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

/** The named functions around `node`, innermost first, with their first parameter. */
function enclosingFunctions(
  node: ts.Node
): Array<{ name: string; parameter: string }> {
  const functions: Array<{ name: string; parameter: string }> = [];
  for (let at = node.parent; at; at = at.parent) {
    if (!ts.isFunctionLike(at)) continue;
    const first = at.parameters[0]?.name;
    const declared =
      ts.isFunctionDeclaration(at) && at.name
        ? at.name
        : ts.isVariableDeclaration(at.parent)
          ? at.parent.name
          : undefined;
    if (
      declared &&
      ts.isIdentifier(declared) &&
      first &&
      ts.isIdentifier(first)
    )
      functions.push({ name: declared.text, parameter: first.text });
  }
  return functions;
}

/** String literal values of a parameter typed as a union of literals. */
function literalParameterValues(name: ts.Identifier): string[] | undefined {
  for (let at = name.parent; at; at = at.parent) {
    if (!ts.isFunctionLike(at)) continue;
    const parameter = at.parameters.find(
      (p) => ts.isIdentifier(p.name) && p.name.text === name.text
    );
    if (!parameter) continue;
    const type = parameter.type;
    const members = type && ts.isUnionTypeNode(type) ? type.types : [type];
    const values = members.map((member) =>
      member &&
      ts.isLiteralTypeNode(member) &&
      ts.isStringLiteral(member.literal)
        ? member.literal.text
        : undefined
    );
    return values.every((value) => value !== undefined) ? values : undefined;
  }
  return undefined;
}

/**
 * Every value a command expression can have, or undefined when it is computed
 * from something this scan cannot read. Reads string literals, conditionals,
 * same-file string constants, and parameters typed as literal unions.
 */
function commandValues(
  node: ts.Expression,
  constants: Map<string, string>,
  parameter?: string
): string[] | undefined {
  if (ts.isStringLiteralLike(node)) return [node.text];
  if (ts.isParenthesizedExpression(node)) {
    return commandValues(node.expression, constants, parameter);
  }
  if (ts.isConditionalExpression(node)) {
    const whenTrue = commandValues(node.whenTrue, constants, parameter);
    const whenFalse = commandValues(node.whenFalse, constants, parameter);
    return whenTrue && whenFalse ? [...whenTrue, ...whenFalse] : undefined;
  }
  if (ts.isIdentifier(node)) {
    if (node.text === parameter) return [PARAMETER];
    const constant = constants.get(node.text);
    return constant === undefined ? literalParameterValues(node) : [constant];
  }
  if (ts.isTemplateExpression(node)) {
    let values = [node.head.text];
    for (const span of node.templateSpans) {
      const parts = commandValues(span.expression, constants, parameter);
      if (!parts) return undefined;
      values = values.flatMap((value) =>
        parts.map((part) => value + part + span.literal.text)
      );
    }
    return values;
  }
  return undefined;
}

/**
 * Every native command the shipped web code calls, by the file calling it,
 * and the calls whose command this scan cannot read. A function that passes
 * its first parameter to `invoke` (the cache host's `request`) is a wrapper,
 * and its callers name the command.
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
      const invokes = new Set<string>();
      const pluginListeners = new Set<string>();
      const constants = new Map<string, string>();
      walk(source, (node) => {
        if (
          ts.isImportDeclaration(node) &&
          ts.isStringLiteral(node.moduleSpecifier) &&
          node.moduleSpecifier.text === TAURI_CORE &&
          node.importClause?.namedBindings &&
          ts.isNamedImports(node.importClause.namedBindings)
        ) {
          for (const element of node.importClause.namedBindings.elements) {
            const imported = (element.propertyName ?? element.name).text;
            if (imported === 'invoke') invokes.add(element.name.text);
            if (imported === 'addPluginListener') {
              pluginListeners.add(element.name.text);
            }
          }
        }
        if (
          ts.isVariableDeclaration(node) &&
          ts.isIdentifier(node.name) &&
          node.initializer &&
          ts.isStringLiteralLike(node.initializer)
        ) {
          constants.set(node.name.text, node.initializer.text);
        }
      });
      const calls: ts.CallExpression[] = [];
      walk(source, (node) => {
        if (
          ts.isCallExpression(node) &&
          ts.isIdentifier(node.expression) &&
          node.arguments[0]
        ) {
          calls.push(node);
        }
      });
      const record = (command: string) => {
        if (!commands.has(command)) commands.set(command, path);
      };
      const unread = (call: ts.CallExpression) => {
        const { line } = source.getLineAndCharacterOfPosition(call.getStart());
        unreadable.push(`${path}:${line + 1} ${call.getText().split('\n')[0]}`);
      };
      const wrappers = new Map<string, string[]>();
      const wrapped = new Set<ts.CallExpression>();
      for (const call of calls) {
        const [command] = call.arguments;
        const callee = (call.expression as ts.Identifier).text;
        if (!command || !invokes.has(callee)) continue;
        if (commandValues(command, constants)) continue;
        for (const wrapper of enclosingFunctions(call)) {
          const shapes = commandValues(command, constants, wrapper.parameter);
          if (shapes?.every((shape) => shape.includes(PARAMETER))) {
            wrappers.set(wrapper.name, shapes);
            wrapped.add(call);
            break;
          }
        }
      }
      for (const call of calls) {
        const [command] = call.arguments;
        const callee = (call.expression as ts.Identifier).text;
        if (!command || wrapped.has(call)) continue;
        const shapes = invokes.has(callee) ? [PARAMETER] : wrappers.get(callee);
        if (pluginListeners.has(callee)) {
          const plugins = commandValues(command, constants);
          if (!plugins) unread(call);
          for (const plugin of plugins ?? []) {
            record(`plugin:${plugin}|register_listener`);
          }
          continue;
        }
        if (!shapes) continue;
        const values = commandValues(command, constants);
        if (!values) {
          unread(call);
          continue;
        }
        for (const shape of shapes) {
          for (const value of values) record(shape.replace(PARAMETER, value));
        }
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
