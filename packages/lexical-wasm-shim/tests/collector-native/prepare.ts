import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { prepareMeasurementGlue } from '../../scripts/measurement/prepare';

const artifact = process.env.COLLECTOR_NATIVE_ARTIFACT_ROOT;
const source = process.env.COLLECTOR_NATIVE_SOURCE_ROOT;
const proof = process.env.COLLECTOR_NATIVE_PROOF_DIR;
const wasmDis = process.env.COLLECTOR_NATIVE_WASM_DIS;
if (!artifact || !source || !proof || !wasmDis)
  throw new Error(
    'Set collector artifact/source/proof directories and actual wasm-dis path'
  );
await mkdir(proof, { recursive: true });
const modulePath = resolve(artifact, 'document_session_wasm.js');
const wasm = resolve(artifact, 'document_session_wasm_bg.wasm');
const declarations = resolve(artifact, 'document_session_wasm.d.ts');
const sha = (data: Uint8Array): string =>
  createHash('sha256').update(data).digest('hex');
const files = [modulePath, wasm, declarations];
const manifestPath = resolve(artifact, 'artifact.json');
const manifest: unknown = JSON.parse(await readFile(manifestPath, 'utf8'));
if (
  manifest === null ||
  typeof manifest !== 'object' ||
  !('sourceCommit' in manifest) ||
  manifest.sourceCommit !== '3386e986871fe7bca32c3c0ca96d1e7de07a7fe2' ||
  !('defaultFeatures' in manifest) ||
  manifest.defaultFeatures !== false ||
  !('features' in manifest) ||
  !Array.isArray(manifest.features) ||
  manifest.features.length !== 1 ||
  manifest.features[0] !== 'compat-web' ||
  !('files' in manifest) ||
  !Array.isArray(manifest.files)
)
  throw new Error(
    'Native artifact does not identify the exact approved compat-web source'
  );
const recorded: readonly unknown[] = manifest.files;
for (const path of files) {
  const digest = sha(await readFile(path));
  const matching = recorded.filter(
    (entry) =>
      entry !== null &&
      typeof entry === 'object' &&
      'path' in entry &&
      entry.path === path &&
      'sha256' in entry &&
      entry.sha256 === digest
  );
  if (matching.length !== 1)
    throw new Error(
      `Native artifact bytes do not match build provenance: ${path}`
    );
}

await prepareMeasurementGlue({
  glue: modulePath,
  wasm,
  wasmDis,
  output: resolve(proof, 'measured.mjs'),
  runtimeImport: resolve(
    import.meta.dirname,
    '../../src/measurement/runtime.ts'
  ),
});
const paths = {
  '@macro-inc/collaboration/session/wasm-compat': [declarations],
  '@macro-inc/collaboration/session/compatibility.generated': [
    resolve(
      source,
      'packages/collaboration/src/session/compatibility.generated.ts'
    ),
  ],
  '@macro-inc/collaboration/session/abi.generated': [
    resolve(source, 'packages/collaboration/src/session/abi.generated.ts'),
  ],
  '@macro-inc/collaboration/session/foreign-native-fields.generated': [
    resolve(
      source,
      'packages/collaboration/src/session/foreign-native-fields.generated.ts'
    ),
  ],
  '@macro-inc/collaboration/session/input': [
    resolve(source, 'packages/collaboration/src/session/input.ts'),
  ],
};
await writeFile(
  resolve(proof, 'tsconfig.json'),
  JSON.stringify(
    {
      extends: resolve(import.meta.dirname, 'tsconfig.json'),
      compilerOptions: {
        paths,
        typeRoots: [resolve(import.meta.dirname, '../../node_modules/@types')],
      },
    },
    null,
    2
  )
);
const hashes = [];
for (const path of files)
  hashes.push({ path, sha256: sha(await readFile(path)) });
await writeFile(
  resolve(proof, 'inputs.json'),
  JSON.stringify(
    {
      classification: 'production-native-lifetime-boundary-only',
      fullMacroAcceptance: false,
      nativeSourceCommit: '3386e986871fe7bca32c3c0ca96d1e7de07a7fe2',
      nodeHandlesBridgeCommit: '6054f87488',
      files: hashes,
      artifactManifest: {
        path: manifestPath,
        sha256: sha(await readFile(manifestPath)),
      },
    },
    null,
    2
  )
);
