import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../../..');

export const nativeEditorProfiles = [
  {
    name: 'native-web-default',
    package: 'document_session_wasm',
    target: 'wasm32-unknown-unknown',
    args: [],
  },
  {
    name: 'native-web-explicit',
    package: 'document_session_wasm',
    target: 'wasm32-unknown-unknown',
    args: ['--no-default-features', '--features', 'bebop-owned-all'],
  },
  {
    name: 'ffi-host',
    package: 'document_session_ffi',
    target: undefined,
    args: [],
  },
  {
    name: 'ffi-android',
    package: 'document_session_ffi',
    target: 'aarch64-linux-android',
    args: [],
  },
  {
    name: 'ffi-ios',
    package: 'document_session_ffi',
    target: 'aarch64-apple-ios',
    args: [],
  },
  {
    name: 'session-headless',
    package: 'document_session',
    target: undefined,
    args: [],
  },
  {
    name: 'macro-headless',
    package: 'macro_document_model',
    target: undefined,
    args: ['--features', 'html'],
  },
  {
    name: 'server-model',
    package: 'sync_server_core',
    target: undefined,
    args: ['--features', 'in-process-gate'],
  },
] as const;

export function assertNativeEditorGraph(
  output: string,
  selectedPackage: string
) {
  const packages = new Set<string>();
  for (const line of output.trim().split('\n')) {
    const fields = line.split('|');
    const name = fields[0]?.split(' ')[0];
    if (fields.length !== 2 || !name || !fields[0].includes(' v')) {
      throw new Error(`Invalid Cargo feature graph row: ${line}`);
    }
    packages.add(name);
    const features = new Set(fields[1].split(',').filter(Boolean));
    if (
      ((name === 'document_session' || name === 'document_session_wasm') &&
        features.has('compatibility')) ||
      (name === 'lexical_model' && features.has('foreign-nodes'))
    ) {
      throw new Error(`Native editor graph enables compatibility: ${line}`);
    }
  }
  if (!packages.has(selectedPackage) || !packages.has('lexical_model')) {
    throw new Error(`Incomplete native editor graph for ${selectedPackage}`);
  }
}

export function assertCompatibilityWebGraph(output: string) {
  for (const [name, feature] of [
    ['document_session_wasm', 'compat-web'],
    ['document_session_wasm', 'compatibility'],
    ['document_session', 'compatibility'],
    ['lexical_model', 'foreign-nodes'],
  ]) {
    if (
      !output.split('\n').some((line) => {
        const [pkg, features] = line.split('|');
        return (
          pkg?.startsWith(`${name} v`) && features?.split(',').includes(feature)
        );
      })
    ) {
      throw new Error(`Compatibility web graph is missing ${name}/${feature}`);
    }
  }
}

export function assertSessionArtifact(
  bytes: Uint8Array,
  kind: 'native' | 'compat'
) {
  const exports = WebAssembly.Module.exports(new WebAssembly.Module(Uint8Array.from(bytes)));
  const names = exports.map((entry) => entry.name);
  if (!names.includes('editorsession_createMacro')) {
    throw new Error('Not a production document-session artifact');
  }
  const compatibility = names.filter((name) => /compat/i.test(name));
  if (kind === 'native' && compatibility.length) {
    throw new Error(
      `Native session exports compatibility: ${compatibility.join(', ')}`
    );
  }
  if (kind === 'compat' && !names.includes('editorsession_createCompat')) {
    throw new Error('Compatibility session is missing createCompat');
  }
}

function checkNativeProfiles() {
  const compiler = spawnSync('rustc', ['-vV'], { encoding: 'utf8' });
  if (compiler.error) throw compiler.error;
  const host = /^host: (.+)$/m.exec(compiler.stdout)?.[1];
  if (compiler.status !== 0 || !host)
    throw new Error('Cannot determine native host target');
  for (const profile of nativeEditorProfiles) {
    const args = [
      'tree',
      '--locked',
      '-p',
      profile.package,
      '--edges',
      'normal,build',
      '--prefix',
      'none',
      '--no-dedupe',
      '--format',
      '{p}|{f}',
      ...profile.args,
    ];
    args.push('--target', profile.target ?? host);
    const result = spawnSync('cargo', args, {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'inherit'],
    });
    if (result.error) throw result.error;
    if (result.status !== 0)
      throw new Error(`Cargo graph failed: ${profile.name}`);
    assertNativeEditorGraph(result.stdout, profile.package);
    console.log(`Native editor feature graph: ${profile.name} passed`);
  }
  const positive = spawnSync(
    'cargo',
    [
      'tree',
      '--locked',
      '-p',
      'document_session_wasm',
      '--target',
      'wasm32-unknown-unknown',
      '--no-default-features',
      '--features',
      'bebop-owned-all,compat-web',
      '--edges',
      'normal,build',
      '--prefix',
      'none',
      '--no-dedupe',
      '--format',
      '{p}|{f}',
    ],
    {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'inherit'],
    }
  );
  if (positive.error) throw positive.error;
  if (positive.status !== 0)
    throw new Error('Cargo graph failed: compatibility-web');
  assertCompatibilityWebGraph(positive.stdout);
  console.log('Explicit compatibility web feature graph passed');
}

if (import.meta.main) {
  const [mode, path] = process.argv.slice(2);
  if ((mode === '--artifact' || mode === '--compat-artifact') && path) {
    assertSessionArtifact(
      readFileSync(path),
      mode === '--artifact' ? 'native' : 'compat'
    );
  } else if (!mode) {
    checkNativeProfiles();
  } else {
    throw new Error(
      'Usage: native-editor-features.ts [--artifact|--compat-artifact PATH]'
    );
  }
}
