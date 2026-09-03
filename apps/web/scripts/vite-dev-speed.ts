import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import ts from 'typescript';
import type { Plugin } from 'vite';

export const PHOSPHOR_VIRTUAL_PREFIX = 'virtual:macro-phosphor/';
const PHOSPHOR_RESOLVED_PREFIX = '\0virtual:macro-phosphor/';

const PHOSPHOR_WEIGHTS = [
  'bold',
  'duotone',
  'fill',
  'light',
  'regular',
  'thin',
] as const;

type PhosphorWeight = (typeof PHOSPHOR_WEIGHTS)[number];

export type BarrelExport = {
  from: string;
  exported: string;
  namespace?: boolean;
};

export type PhosphorIconRef = {
  key: string;
  weight: PhosphorWeight;
  file: string;
  absPath: string;
};

const PHOSPHOR_SPEC_RE =
  /^(?:@phosphor\/|(?:@phosphor-icons\/core\/(?:assets\/)?(bold|duotone|fill|light|regular|thin)\/))([^?#]+\.svg)/;

export function parsePhosphorSpecifier(
  specifier: string
): { weight: PhosphorWeight; file: string } | null {
  const bare = specifier.split('?')[0] ?? specifier;
  if (bare.startsWith('@phosphor/')) {
    const file = bare.slice('@phosphor/'.length);
    return file.endsWith('.svg') ? { weight: 'regular', file } : null;
  }
  if (bare.startsWith('@phosphor-fill/')) {
    const file = bare.slice('@phosphor-fill/'.length);
    return file.endsWith('.svg') ? { weight: 'fill', file } : null;
  }
  const match = PHOSPHOR_SPEC_RE.exec(bare);
  if (!match) return null;
  const weight = (match[1] ?? 'regular') as PhosphorWeight;
  const file = match[2] ?? '';
  if (!file.endsWith('.svg')) return null;
  return { weight, file };
}

export function phosphorExportKey(
  weight: PhosphorWeight,
  file: string
): string {
  return `${weight}_${file.replace(/\.svg$/, '').replace(/[^a-zA-Z0-9]/g, '_')}`;
}

export function compileSvgComponent(
  svg: string,
  exportKind: 'default' | { name: string }
): string {
  const escaped = svg
    .trim()
    .replace(/\\/g, '\\\\')
    .replace(/`/g, '\\`')
    .replace(/\$\{/g, '\\${');
  const fn =
    exportKind === 'default'
      ? 'export default function Icon(props)'
      : `export function ${exportKind.name}(props)`;
  return `import { spread, template } from "solid-js/web";
const _tmpl = /*@__PURE__*/ template(\`${escaped}\`, false, true);
${fn} {
  const el = _tmpl();
  spread(el, props, true);
  return el;
}
`;
}

function resolveRelativeModule(
  fromFile: string,
  spec: string,
  fileExists: (path: string) => boolean
): string | null {
  const base = resolve(dirname(fromFile), spec);
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.js`,
    `${base}.jsx`,
    join(base, 'index.ts'),
    join(base, 'index.tsx'),
    join(base, 'index.js'),
  ];
  for (const candidate of candidates) {
    if (fileExists(candidate)) return candidate;
  }
  return null;
}

function aliasForFile(
  alias: string,
  barrelFile: string,
  targetFile: string
): string {
  const barrelDir = dirname(barrelFile);
  let rel = relative(barrelDir, targetFile).replaceAll('\\', '/');
  rel = rel.replace(/\.(tsx|ts|jsx|js)$/, '');
  rel = rel.replace(/\/index$/, '');
  return `${alias}/${rel}`;
}

function collectExportedNames(
  sourceFile: ts.SourceFile
): Array<{ name: string; exported: string } | { star: true } | { skip: true }> {
  const names: Array<
    { name: string; exported: string } | { star: true } | { skip: true }
  > = [];
  for (const stmt of sourceFile.statements) {
    if (ts.isExportDeclaration(stmt)) {
      if (!stmt.exportClause) {
        names.push({ star: true });
        continue;
      }
      if (ts.isNamespaceExport(stmt.exportClause)) continue;
      if (!ts.isNamedExports(stmt.exportClause)) continue;
      for (const el of stmt.exportClause.elements) {
        names.push({
          name: el.name.text,
          exported: el.propertyName?.text ?? el.name.text,
        });
      }
      continue;
    }
    if (ts.isExportAssignment(stmt)) continue;
    const mods = ts.canHaveModifiers(stmt) ? ts.getModifiers(stmt) : undefined;
    const isExport = mods?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
    if (!isExport) continue;
    if (ts.isVariableStatement(stmt)) {
      for (const decl of stmt.declarationList.declarations) {
        if (ts.isIdentifier(decl.name)) {
          names.push({ name: decl.name.text, exported: decl.name.text });
        }
      }
    } else if (
      (ts.isFunctionDeclaration(stmt) ||
        ts.isClassDeclaration(stmt) ||
        ts.isEnumDeclaration(stmt) ||
        ts.isTypeAliasDeclaration(stmt) ||
        ts.isInterfaceDeclaration(stmt)) &&
      stmt.name
    ) {
      names.push({ name: stmt.name.text, exported: stmt.name.text });
    }
  }
  return names;
}

export function buildBarrelExportMap(
  barrelPath: string,
  alias: string,
  readFile: (path: string) => string,
  fileExists: (path: string) => boolean
): Map<string, BarrelExport> {
  const map = new Map<string, BarrelExport>();
  const visited = new Set<string>();

  const visit = (file: string, starInto?: string) => {
    if (visited.has(file)) return;
    visited.add(file);
    if (!fileExists(file)) return;
    const sourceFile = ts.createSourceFile(
      file,
      readFile(file),
      ts.ScriptTarget.Latest,
      true,
      file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
    );

    for (const stmt of sourceFile.statements) {
      if (!ts.isExportDeclaration(stmt)) continue;
      const spec = stmt.moduleSpecifier;
      if (!spec || !ts.isStringLiteral(spec)) {
        if (file === barrelPath && stmt.exportClause && ts.isNamedExports(stmt.exportClause)) {
          for (const el of stmt.exportClause.elements) {
            const name = el.name.text;
            map.set(name, {
              from: aliasForFile(alias, barrelPath, file),
              exported: el.propertyName?.text ?? name,
            });
          }
        }
        continue;
      }

      const target = resolveRelativeModule(file, spec.text, fileExists);
      if (!target) continue;

      if (stmt.exportClause && ts.isNamespaceExport(stmt.exportClause)) {
        const name = stmt.exportClause.name.text;
        if (file === barrelPath || starInto) {
          map.set(starInto ?? name, {
            from: aliasForFile(alias, barrelPath, target),
            exported: name,
            namespace: true,
          });
        }
        continue;
      }

      if (!stmt.exportClause) {
        if (file === barrelPath) {
          visit(target);
        } else {
          visit(target, starInto);
        }
        continue;
      }

      if (!ts.isNamedExports(stmt.exportClause)) continue;
      if (stmt.exportClause.elements.length === 0) continue;

      const from = aliasForFile(alias, barrelPath, target);
      for (const el of stmt.exportClause.elements) {
        const name = el.name.text;
        map.set(starInto ?? name, {
          from,
          exported: el.propertyName?.text ?? name,
        });
      }
    }

    if (file !== barrelPath) {
      for (const entry of collectExportedNames(sourceFile)) {
        if ('star' in entry || 'skip' in entry) continue;
        if (!map.has(entry.name)) {
          map.set(entry.name, {
            from: aliasForFile(alias, barrelPath, file),
            exported: entry.exported,
          });
        }
      }
    }
  };

  visit(barrelPath);
  return map;
}

function printNamedImport(
  from: string,
  specifiers: Array<{ exported: string; local: string; typeOnly: boolean }>
): string {
  const inner = specifiers
    .map((spec) => {
      const prefix = spec.typeOnly ? 'type ' : '';
      return spec.exported === spec.local
        ? `${prefix}${spec.exported}`
        : `${prefix}${spec.exported} as ${spec.local}`;
    })
    .join(', ');
  const allType = specifiers.every((spec) => spec.typeOnly);
  return allType
    ? `import type { ${inner.replace(/type /g, '')} } from '${from}';`
    : `import { ${inner} } from '${from}';`;
}

export function rewriteBarrelImports(
  code: string,
  fileName: string,
  barrels: Map<string, Map<string, BarrelExport>>
): string | null {
  const sourceFile = ts.createSourceFile(
    fileName,
    code,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );
  const replacements: Array<{ start: number; end: number; text: string }> = [];

  for (const stmt of sourceFile.statements) {
    const specNode =
      (ts.isImportDeclaration(stmt) || ts.isExportDeclaration(stmt)) &&
      stmt.moduleSpecifier &&
      ts.isStringLiteral(stmt.moduleSpecifier)
        ? stmt.moduleSpecifier
        : null;
    if (!specNode) continue;
    const mapping = barrels.get(specNode.text);
    if (!mapping) continue;

    if (ts.isImportDeclaration(stmt)) {
      if (!stmt.importClause) continue;
      if (stmt.importClause.name || stmt.importClause.namedBindings) {
        if (
          stmt.importClause.namedBindings &&
          ts.isNamespaceImport(stmt.importClause.namedBindings)
        ) {
          continue;
        }
      }
      const clause = stmt.importClause;
      if (!clause.namedBindings || !ts.isNamedImports(clause.namedBindings)) {
        continue;
      }

      const byFile = new Map<
        string,
        Array<{ exported: string; local: string; typeOnly: boolean }>
      >();
      const namespaces: string[] = [];
      const leftover: ts.ImportSpecifier[] = [];

      for (const el of clause.namedBindings.elements) {
        const imported = el.propertyName?.text ?? el.name.text;
        const target = mapping.get(imported);
        if (!target) {
          leftover.push(el);
          continue;
        }
        if (target.namespace) {
          const typePrefix = clause.isTypeOnly || el.isTypeOnly ? 'type ' : '';
          namespaces.push(
            `import ${typePrefix}* as ${el.name.text} from '${target.from}';`
          );
          continue;
        }
        const list = byFile.get(target.from) ?? [];
        list.push({
          exported: target.exported,
          local: el.name.text,
          typeOnly: clause.isTypeOnly || el.isTypeOnly,
        });
        byFile.set(target.from, list);
      }

      if (byFile.size === 0 && namespaces.length === 0) continue;

      const next: string[] = [...namespaces];
      for (const [from, specs] of byFile) {
        next.push(printNamedImport(from, specs));
      }
      if (leftover.length > 0) {
        const allType = clause.isTypeOnly;
        const inner = leftover
          .map((el) => {
            const typePrefix = !allType && el.isTypeOnly ? 'type ' : '';
            const imported = el.propertyName?.text ?? el.name.text;
            return imported === el.name.text
              ? `${typePrefix}${imported}`
              : `${typePrefix}${imported} as ${el.name.text}`;
          })
          .join(', ');
        next.push(
          allType
            ? `import type { ${inner} } from '${specNode.text}';`
            : `import { ${inner} } from '${specNode.text}';`
        );
      }
      replacements.push({
        start: stmt.getStart(sourceFile),
        end: stmt.getEnd(),
        text: next.join('\n'),
      });
      continue;
    }

    if (!ts.isExportDeclaration(stmt) || !stmt.exportClause) continue;
    if (!ts.isNamedExports(stmt.exportClause)) continue;

    const byFile = new Map<
      string,
      Array<{ exported: string; local: string; typeOnly: boolean }>
    >();
    const leftover: ts.ExportSpecifier[] = [];
    for (const el of stmt.exportClause.elements) {
      const imported = el.propertyName?.text ?? el.name.text;
      const target = mapping.get(imported);
      if (!target || target.namespace) {
        leftover.push(el);
        continue;
      }
      const list = byFile.get(target.from) ?? [];
      list.push({
        exported: target.exported,
        local: el.name.text,
        typeOnly: Boolean(stmt.isTypeOnly || el.isTypeOnly),
      });
      byFile.set(target.from, list);
    }
    if (byFile.size === 0) continue;

    const next: string[] = [];
    for (const [from, specs] of byFile) {
      const allType = specs.every((spec) => spec.typeOnly);
      const inner = specs
        .map((spec) => {
          const prefix = !allType && spec.typeOnly ? 'type ' : '';
          return spec.exported === spec.local
            ? `${prefix}${spec.exported}`
            : `${prefix}${spec.exported} as ${spec.local}`;
        })
        .join(', ');
      next.push(
        allType
          ? `export type { ${inner.replace(/type /g, '')} } from '${from}';`
          : `export { ${inner} } from '${from}';`
      );
    }
    if (leftover.length > 0) {
      const inner = leftover
        .map((el) => {
          const imported = el.propertyName?.text ?? el.name.text;
          return imported === el.name.text
            ? imported
            : `${imported} as ${el.name.text}`;
        })
        .join(', ');
      next.push(`export { ${inner} } from '${specNode.text}';`);
    }
    replacements.push({
      start: stmt.getStart(sourceFile),
      end: stmt.getEnd(),
      text: next.join('\n'),
    });
  }

  if (replacements.length === 0) return null;
  replacements.sort((a, b) => b.start - a.start);
  let next = code;
  for (const replacement of replacements) {
    next =
      next.slice(0, replacement.start) +
      replacement.text +
      next.slice(replacement.end);
  }
  return next;
}

export function rewritePhosphorImports(
  code: string,
  resolveIcon: (specifier: string) => PhosphorIconRef | null
): string | null {
  if (
    !code.includes('@phosphor/') &&
    !code.includes('@phosphor-fill/') &&
    !code.includes('@phosphor-icons/core/')
  ) {
    return null;
  }
  const sourceFile = ts.createSourceFile(
    'icon.tsx',
    code,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  );
  const replacements: Array<{ start: number; end: number; text: string }> = [];

  for (const stmt of sourceFile.statements) {
    const specNode =
      (ts.isImportDeclaration(stmt) || ts.isExportDeclaration(stmt)) &&
      stmt.moduleSpecifier &&
      ts.isStringLiteral(stmt.moduleSpecifier)
        ? stmt.moduleSpecifier
        : null;
    if (!specNode) continue;
    const icon = resolveIcon(specNode.text);
    if (!icon) continue;

    if (ts.isImportDeclaration(stmt)) {
      const clause = stmt.importClause;
      if (!clause) continue;
      if (clause.name && !clause.namedBindings) {
        replacements.push({
          start: stmt.getStart(sourceFile),
          end: stmt.getEnd(),
          text: `import ${clause.name.text} from '${PHOSPHOR_VIRTUAL_PREFIX}${icon.key}';`,
        });
        continue;
      }
      if (
        clause.namedBindings &&
        ts.isNamedImports(clause.namedBindings) &&
        clause.namedBindings.elements.length === 1
      ) {
        const el = clause.namedBindings.elements[0];
        if ((el.propertyName?.text ?? el.name.text) === 'default') {
          replacements.push({
            start: stmt.getStart(sourceFile),
            end: stmt.getEnd(),
            text: `import ${el.name.text} from '${PHOSPHOR_VIRTUAL_PREFIX}${icon.key}';`,
          });
        }
      }
      continue;
    }

    if (
      ts.isExportDeclaration(stmt) &&
      stmt.exportClause &&
      ts.isNamedExports(stmt.exportClause)
    ) {
      const lines = stmt.exportClause.elements.map((el) => {
        return `export { default as ${el.name.text} } from '${PHOSPHOR_VIRTUAL_PREFIX}${icon.key}';`;
      });
      replacements.push({
        start: stmt.getStart(sourceFile),
        end: stmt.getEnd(),
        text: lines.join('\n'),
      });
    }
  }

  if (replacements.length === 0) {
    return null;
  }
  replacements.sort((a, b) => b.start - a.start);
  let next = code;
  for (const replacement of replacements) {
    next =
      next.slice(0, replacement.start) +
      replacement.text +
      next.slice(replacement.end);
  }
  return next;
}

function unbarrelPlugin(root: string): Plugin {
  const barrels: Array<{ alias: string; file: string }> = [
    { alias: '@ui', file: resolve(root, 'src/components/ui/index.ts') },
    { alias: '@entity', file: resolve(root, 'src/features/entity/index.ts') },
    {
      alias: '@property',
      file: resolve(root, 'src/features/property/index.ts'),
    },
    {
      alias: '@notifications',
      file: resolve(root, 'src/features/notifications/index.ts'),
    },
    { alias: '@macro/tauri', file: resolve(root, 'src/lib/tauri/index.ts') },
  ];
  let maps = new Map<string, Map<string, BarrelExport>>();

  const rebuild = () => {
    const next = new Map<string, Map<string, BarrelExport>>();
    for (const barrel of barrels) {
      if (!existsSync(barrel.file)) continue;
      next.set(
        barrel.alias,
        buildBarrelExportMap(
          barrel.file,
          barrel.alias,
          (path) => readFileSync(path, 'utf8'),
          (path) => existsSync(path) && statSync(path).isFile()
        )
      );
    }
    maps = next;
  };

  return {
    name: 'macro-unbarrel',
    apply: 'serve',
    enforce: 'pre',
    buildStart() {
      rebuild();
    },
    transform(code, id) {
      const file = id.split('?')[0] ?? id;
      if (!/\.(tsx|ts|jsx|js)$/.test(file)) return null;
      if (file.includes('node_modules')) return null;
      if (
        !code.includes("from '@ui'") &&
        !code.includes('from "@ui"') &&
        !code.includes("from '@entity'") &&
        !code.includes('from "@entity"') &&
        !code.includes("from '@property'") &&
        !code.includes('from "@property"') &&
        !code.includes("from '@notifications'") &&
        !code.includes('from "@notifications"') &&
        !code.includes("from '@macro/tauri'") &&
        !code.includes('from "@macro/tauri"')
      ) {
        return null;
      }
      const rewritten = rewriteBarrelImports(code, file, maps);
      if (!rewritten) return null;
      return { code: rewritten, map: null };
    },
  };
}

function phosphorIconsPlugin(root: string): Plugin {
  const phosphorRoot = resolve(
    root,
    '../../node_modules/@phosphor-icons/core/assets'
  );
  const icons = new Map<string, PhosphorIconRef>();

  const resolveIcon = (specifier: string): PhosphorIconRef | null => {
    const parsed = parsePhosphorSpecifier(specifier);
    if (!parsed) return null;
    const key = phosphorExportKey(parsed.weight, parsed.file);
    const existing = icons.get(key);
    if (existing) return existing;
    const absPath = join(phosphorRoot, parsed.weight, parsed.file);
    if (!existsSync(absPath)) return null;
    const ref: PhosphorIconRef = { key, ...parsed, absPath };
    icons.set(key, ref);
    return ref;
  };

  return {
    name: 'macro-phosphor-icons',
    apply: 'serve',
    enforce: 'pre',
    resolveId(id) {
      if (id.startsWith(PHOSPHOR_VIRTUAL_PREFIX)) return `\0${id}`;
      const icon = resolveIcon(id);
      if (!icon) return null;
      return `\0${PHOSPHOR_VIRTUAL_PREFIX}${icon.key}`;
    },
    load(id) {
      if (!id.startsWith(PHOSPHOR_RESOLVED_PREFIX)) return null;
      const key = id.slice(PHOSPHOR_RESOLVED_PREFIX.length);
      const icon = icons.get(key);
      if (!icon) return null;
      const svg = readFileSync(icon.absPath, 'utf8');
      return compileSvgComponent(svg, 'default');
    },
    transform(code, id) {
      const file = id.split('?')[0] ?? id;
      if (!/\.(tsx|ts|jsx|js)$/.test(file)) return null;
      if (file.includes('node_modules')) return null;
      const rewritten = rewritePhosphorImports(code, resolveIcon);
      if (!rewritten) return null;
      return { code: rewritten, map: null };
    },
  };
}

function transformTimingPlugin(): Plugin {
  return {
    name: 'macro-transform-timing',
    apply: 'serve',
    configureServer(server) {
      if (process.env.DEBUG_VITE_TRANSFORM !== 'true') return;
      const original = server.transformRequest.bind(server);
      server.transformRequest = async (url, options) => {
        const started = performance.now();
        try {
          return await original(url, options);
        } finally {
          const ms = performance.now() - started;
          if (ms >= 25) {
            server.config.logger.info(
              `[vite-transform] ${ms.toFixed(1)}ms ${url}`
            );
          }
        }
      };
    },
  };
}

export function createDevSpeedPlugins(root: string): Plugin[] {
  return [
    unbarrelPlugin(root),
    phosphorIconsPlugin(root),
    transformTimingPlugin(),
  ];
}
