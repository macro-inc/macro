import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import nativeCommands from '../../../native-commands.json';

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const repositoryRoot = resolve(webRoot, '../..');
const tauriRoot = resolve(webRoot, 'tauri');
const SOURCE_ROOTS = ['apps/web/src', 'packages'];

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

/** Every native command the shipped web code calls, by the file calling it. */
function invokedCommands(): Map<string, string> {
  const commands = new Map<string, string>();
  const literal = `\\s*['"](plugin:[a-z0-9-]+\\|[a-z0-9_]+|[a-z][a-z0-9_]*)['"]`;
  const patterns = [
    new RegExp(`\\binvoke(?:<[^(]*>)?\\(${literal}`, 'g'),
    // The cache host wraps invoke in `request`, with names inline or in
    // `*_COMMAND` constants.
    new RegExp(`\\brequest(?:<[^(]*>)?\\(${literal}`, 'g'),
    new RegExp(`\\b[A-Z_]+_COMMAND\\s*=${literal}`, 'g'),
  ];
  for (const root of SOURCE_ROOTS) {
    for (const file of sourceFiles(resolve(repositoryRoot, root))) {
      const source = readFileSync(file, 'utf8');
      if (!source.includes("from '@tauri-apps/api/core'")) continue;
      for (const pattern of patterns) {
        for (const match of source.matchAll(pattern)) {
          const command = match[1];
          if (command && !commands.has(command)) {
            commands.set(command, relative(repositoryRoot, file));
          }
        }
      }
    }
  }
  return commands;
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
      new Set([...build.matchAll(/"([a-z0-9_]+)"/g)].map((m) => m[1] ?? ''))
    );
  }
  return plugins;
}

describe('native commands', () => {
  const invoked = invokedCommands();

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
      const plugin = /^plugin:([a-z0-9-]+)\|([a-z0-9_]+)$/.exec(command);
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
