import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { declarationNames, discover } from './inventory';
import { parseProbe } from './probe-result';
import {
  compareDeclarationNames,
  compareRuntime,
  type NamespaceFacts,
} from './surface';

const here = dirname(fileURLToPath(import.meta.url));
const shim = resolve(here, '../..');
const repository = resolve(shim, '../..');
const output = process.env.LEXICAL_EXPORT_OUTPUT
  ? resolve(process.env.LEXICAL_EXPORT_OUTPUT)
  : mkdtempSync(
      join(process.env.TMPDIR ?? tmpdir(), 'lexical-export-surface-')
    );
mkdirSync(output, { recursive: true });
const root = join(shim, 'src/index.ts');
const options: ts.CompilerOptions = {
  target: ts.ScriptTarget.ESNext,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  strict: true,
  noEmit: true,
  skipLibCheck: false,
};

function probe(specifier: string, facade?: string): NamespaceFacts {
  const child = spawnSync(
    'bun',
    [join(here, 'runtime-probe.ts'), specifier, ...(facade ? [facade] : [])],
    {
      cwd: repository,
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
      env: { ...process.env, NODE_ENV: 'development' },
    }
  );
  return parseProbe(
    child.stdout ?? '',
    child.status,
    child.stderr || String(child.error ?? '')
  );
}

function declarations(specifier: string): string {
  const result = ts.resolveModuleName(
    specifier,
    join(repository, 'apps/web/src/export-surface-contract.ts'),
    options,
    ts.sys
  ).resolvedModule;
  if (!result || !/\.d\.[cm]?ts$/.test(result.resolvedFileName))
    throw new Error('Pinned declaration entry unavailable: ' + specifier);
  return result.resolvedFileName;
}

const report: Record<string, unknown> = {
  status: 'in-progress',
  output,
  compiler: ts.version,
  namespaces: [],
};
try {
  if (ts.version !== '6.0.3')
    throw new Error('The producer TypeScript 6.0.3 is required');
  const imports = discover(repository);
  const specifiers = [...imports.keys()].sort();
  report.callers = Object.fromEntries(imports);
  const declarationEntries = new Map<string, string>();
  const packages = new Map<
    string,
    { version: string; metadataSha256: string }
  >();
  for (const specifier of specifiers) {
    const name =
      specifier === 'lexical'
        ? specifier
        : specifier.split('/').slice(0, 2).join('/');
    const bytes = readFileSync(
      join(repository, 'node_modules', name, 'package.json')
    );
    const metadata: unknown = JSON.parse(bytes.toString());
    if (
      metadata === null ||
      typeof metadata !== 'object' ||
      !('version' in metadata) ||
      metadata.version !== '0.45.0'
    )
      throw new Error('Expected pinned v0.45 package: ' + name);
    packages.set(name, {
      version: metadata.version,
      metadataSha256: createHash('sha256').update(bytes).digest('hex'),
    });
    declarationEntries.set(specifier, declarations(specifier));
  }
  report.packages = Object.fromEntries(packages);
  const emitDirectory = join(output, 'ordinary-declarations');
  const emit = spawnSync(
    'bun',
    [
      join(shim, 'node_modules/typescript/bin/tsc'),
      '--project',
      join(shim, 'tsconfig.json'),
      '--noEmit',
      'false',
      '--declaration',
      '--emitDeclarationOnly',
      '--noEmitOnError',
      '--rootDir',
      repository,
      '--outDir',
      emitDirectory,
    ],
    {
      cwd: shim,
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
    }
  );
  writeFileSync(join(output, 'ordinary-emit.log'), emit.stdout + emit.stderr);
  if (emit.status !== 0)
    throw new Error(
      'Ordinary actual declaration emit failed: ' + emit.stdout + emit.stderr
    );
  report.ordinaryEmit = 'pass';
  const actualRoot = join(
    emitDirectory,
    'packages/lexical-wasm-shim/src/index.d.ts'
  );
  const modules = specifiers.map((specifier) => {
    const expectedEntry = declarationEntries.get(specifier);
    if (!expectedEntry) throw new Error('Missing declaration inventory entry');
    const actualEntry = specifier === 'lexical' ? actualRoot : expectedEntry;
    const expectedNames = declarationNames(expectedEntry, options);
    const actualNames = declarationNames(actualEntry, options);
    const expectedRuntime = probe(specifier);
    const actualRuntime = probe(specifier, root);
    return {
      specifier,
      // External packages stay unchanged, but must evaluate against the actual
      // facade root. They are not claimed as independently implemented ports.
      route:
        specifier === 'lexical'
          ? 'actual-facade'
          : 'unchanged-package-with-actual-facade-root',
      declarations: {
        expectedEntry,
        actualEntry,
        expected: expectedNames,
        actual: actualNames,
        ...compareDeclarationNames(expectedNames, actualNames),
      },
      runtime: {
        expectedCount: expectedRuntime.exports.size,
        actualCount: actualRuntime.exports.size,
        ...compareRuntime(expectedRuntime, actualRuntime),
      },
    };
  });
  report.namespaces = modules;
  const failed = modules.filter(
    (module) =>
      module.runtime.status !== 'match' ||
      module.declarations.missing.length ||
      module.declarations.extra.length
  );
  report.status = failed.length ? 'fail' : 'pass';
  report.summary = {
    namespaces: modules.length,
    failed: failed.length,
    runtimeBlocked: modules.filter(
      (module) => module.runtime.status === 'blocked'
    ).length,
    runtimeMismatches: modules.reduce(
      (n, module) => n + module.runtime.mismatches.length,
      0
    ),
    runtimeMissing: modules.reduce(
      (n, module) => n + module.runtime.missing.length,
      0
    ),
    runtimeExtra: modules.reduce(
      (n, module) => n + module.runtime.extra.length,
      0
    ),
    declarationMissing: modules.reduce(
      (n, module) => n + module.declarations.missing.length,
      0
    ),
    declarationExtra: modules.reduce(
      (n, module) => n + module.declarations.extra.length,
      0
    ),
  };
  process.exitCode = failed.length ? 1 : 0;
} catch (error) {
  report.status = 'blocked';
  report.error =
    error instanceof Error
      ? error.message
      : 'Non-Error surface-contract failure';
  process.exitCode = 1;
} finally {
  const path = join(output, 'surface.json');
  writeFileSync(path, JSON.stringify(report, null, 2) + '\n');
  console.log(
    JSON.stringify({
      status: report.status,
      summary: report.summary,
      error: report.error,
      report: path,
    })
  );
}
