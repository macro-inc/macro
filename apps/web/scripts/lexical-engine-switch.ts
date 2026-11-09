import { readFile, readdir } from 'node:fs/promises';
import type { Plugin } from 'vite';

const SWITCH_PREFIX = '\0macro-lexical-switch:';
const UPSTREAM_PREFIX = 'lexical-upstream:';

export interface LexicalEngineSwitchOptions {
  /** Exports the immutable RUST_EDITOR_ENGINE choice, resolved before editors. */
  selectionModule: string;
  /** Production-compatible package with the same root and package subpaths. */
  compatPackage: string;
}

function isLexicalModule(id: string): boolean {
  return id === 'lexical' || id.startsWith('@lexical/');
}

/** Bind classes, commands and functions once without changing application imports. */
export function lexicalEngineSwitch(
  options: LexicalEngineSwitchOptions
): Plugin {
  return {
    name: 'macro-lexical-engine-switch',
    enforce: 'pre',
    async config() {
      const installed = await readdir(
        new URL('../../../node_modules/@lexical/', import.meta.url)
      );
      const modules = [
        'lexical',
        options.compatPackage,
        ...installed.map((name) => `@lexical/${name}`),
      ];
      // Prebundling a helper with its own upstream core would bypass the
      // switch and split node classes, commands and active update contexts.
      return {
        optimizeDeps: { exclude: modules },
        ssr: { noExternal: modules },
      };
    },
    async resolveId(id, importer, resolveOptions) {
      if (id.startsWith(UPSTREAM_PREFIX)) {
        const original = id.slice(UPSTREAM_PREFIX.length);
        if (!isLexicalModule(original))
          throw new Error(`Invalid upstream Lexical escape: ${original}`);
        const resolved = await this.resolve(original, importer, {
          ...resolveOptions,
          skipSelf: true,
        });
        if (!resolved) throw new Error(`Cannot resolve upstream ${original}`);
        return { ...resolved, external: false };
      }
      if (isLexicalModule(id)) return SWITCH_PREFIX + id;
    },
    async load(id) {
      if (!id.startsWith(SWITCH_PREFIX)) return;
      const original = id.slice(SWITCH_PREFIX.length);
      const upstream = await this.resolve(
        UPSTREAM_PREFIX + original,
        undefined,
        {
          skipSelf: false,
        }
      );
      if (!upstream) throw new Error(`Cannot resolve upstream ${original}`);
      const source = await readFile(upstream.id.split('?')[0], 'utf8');
      const names: string[] = [];
      for (const statement of this.parse(source).body) {
        if (statement.type === 'ExportDefaultDeclaration')
          names.push('default');
        if (statement.type !== 'ExportNamedDeclaration') continue;
        for (const specifier of statement.specifiers) {
          const exported = specifier.exported;
          const name =
            exported.type === 'Identifier' ? exported.name : exported.value;
          if (typeof name !== 'string')
            throw new Error(`Invalid export name in ${original}`);
          names.push(name);
        }
        const declaration = statement.declaration;
        if (!declaration) continue;
        if (declaration.type === 'VariableDeclaration') {
          for (const variable of declaration.declarations) {
            if (variable.id.type !== 'Identifier')
              throw new Error(`Unexpected destructured export in ${original}`);
            names.push(variable.id.name);
          }
        } else if (declaration.id) {
          names.push(declaration.id.name);
        }
      }
      if (names.length === 0)
        throw new Error(`No runtime exports found in ${original}`);
      const compat =
        original === 'lexical'
          ? options.compatPackage
          : `${options.compatPackage}/${original.slice('@lexical/'.length)}`;
      const bindings = [...new Set(names)].map((name, index) => {
        const local = `binding${index}`;
        return `const ${local} = selected[${JSON.stringify(name)}];\nexport { ${local} as ${name} };`;
      });
      return [
        `import * as upstream from ${JSON.stringify(UPSTREAM_PREFIX + original)};`,
        `import * as compat from ${JSON.stringify(compat)};`,
        `import { RUST_EDITOR_ENGINE } from ${JSON.stringify(options.selectionModule)};`,
        'const selected = RUST_EDITOR_ENGINE ? compat : upstream;',
        `for (const name of ${JSON.stringify([...new Set(names)])}) {`,
        `  if (!(name in selected)) throw new Error(${JSON.stringify(`Missing selected engine export in ${original}: `)} + name);`,
        '}',
        ...bindings,
      ].join('\n');
    },
  };
}
