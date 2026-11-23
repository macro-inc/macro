import { readFileSync } from 'node:fs';
import type { Plugin } from 'vite';

const STUB_PREFIX = '\0calendar-fixture-stub:';
const EMPTY_PREFIX = '\0calendar-fixture-empty:';

/** Value names a module exports, read from its source. */
function exportedNames(path: string): string[] {
  const code = readFileSync(path, 'utf8');
  const names: string[] = [];
  for (const match of code.matchAll(
    /^export\s+(?:async\s+)?(?:function\*?|const|let|var|class)\s+([A-Za-z_$][\w$]*)/gm
  ))
    names.push(match[1] ?? '');
  for (const match of code.matchAll(
    /^export\s+(?:const|let|var)\s+[[{]([^\]}]*)[\]}]\s*=/gm
  ))
    names.push(...(match[1] ?? '').split(','));
  for (const match of code.matchAll(/^export\s+\{([^}]*)\}/gm))
    names.push(
      ...(match[1] ?? '')
        .split(',')
        .filter((member) => !member.trim().startsWith('type '))
        .map((member) => member.split(/\s+as\s+/).at(-1) ?? '')
    );
  return [...new Set(names.map((name) => name.trim()).filter(Boolean))];
}

export interface ShellStubs {
  /** The stubs' directory; imports from inside it reach the real modules. */
  stubDirectory: string;
  /** Real module path to the file that stands in for it. */
  stubs: Record<string, string>;
  /** Real module path to component names that render nothing. */
  emptyComponents: Record<string, string[]>;
}

/**
 * Replaces app-shell modules by their real file path, so relative imports are
 * caught as well as aliased ones. A stub file states only what its page
 * drives: every other export of the real module becomes an inert placeholder
 * that warns when it is called, so a module that merely imports a name still
 * loads.
 */
export function shellStubs(config: ShellStubs): Plugin {
  return {
    name: 'calendar-fixture-shell-stubs',
    enforce: 'pre',
    async resolveId(id, importer, options) {
      if (!importer || id.startsWith('\0')) return null;
      if (importer.startsWith(STUB_PREFIX))
        return this.resolve(id, importer.slice(STUB_PREFIX.length), {
          ...options,
          skipSelf: true,
        });
      const resolved = await this.resolve(id, importer, {
        ...options,
        skipSelf: true,
      });
      const path = resolved?.id.split('?')[0];
      if (!path) return null;
      if (config.stubs[path] && !importer.startsWith(config.stubDirectory))
        return `${STUB_PREFIX}${path}`;
      if (config.emptyComponents[path]) return `${EMPTY_PREFIX}${path}`;
      return null;
    },
    load(id) {
      if (id.startsWith(EMPTY_PREFIX)) {
        const names = config.emptyComponents[id.slice(EMPTY_PREFIX.length)];
        return (names ?? [])
          .map((name) => `export const ${name} = () => null;`)
          .join('\n');
      }
      if (!id.startsWith(STUB_PREFIX)) return null;
      const real = id.slice(STUB_PREFIX.length);
      const stub = config.stubs[real];
      if (!stub) return null;
      this.addWatchFile(stub);
      const provided = new Set(exportedNames(stub));
      const missing = exportedNames(real).filter((name) => !provided.has(name));
      return [
        `export * from ${JSON.stringify(stub)};`,
        `const placeholder = (name) => new Proxy(function () {}, {`,
        `  apply() { console.warn('calendar fixture: ' + name + ' is not stubbed'); return undefined; },`,
        `  get(_, key) { return typeof key === 'symbol' || key === 'then' ? undefined : placeholder(name + '.' + String(key)); },`,
        `});`,
        ...missing.map(
          (name) =>
            `export const ${name} = placeholder(${JSON.stringify(name)});`
        ),
      ].join('\n');
    },
  };
}
