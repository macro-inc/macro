import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { readModuleAbi } from './abi';
import { instrumentGlue } from './glue';

const sha = (bytes: string | Uint8Array): string =>
  createHash('sha256').update(bytes).digest('hex');

export async function prepareMeasurementGlue(options: {
  readonly glue: string;
  readonly wasm: string;
  readonly wasmDis: string;
  readonly output: string;
  readonly runtimeImport: string;
}): Promise<void> {
  const original = await readFile(options.glue, 'utf8');
  const bytes = await readFile(options.wasm);
  const module = await WebAssembly.compile(bytes);
  await mkdir(dirname(options.output), { recursive: true });
  const wat = `${options.output}.wat`;
  await new Promise<void>((accept, reject) => {
    const child = spawn(options.wasmDis, [options.wasm, '-o', wat], {
      stdio: 'inherit',
    });
    child.once('error', reject);
    child.once('exit', (code) =>
      code === 0 ? accept() : reject(new Error(`wasm-dis failed: ${code}`))
    );
  });
  const abi = await readModuleAbi(createReadStream(wat));
  const actualImports = WebAssembly.Module.imports(module)
    .map((entry) => `${entry.kind}:${entry.module}:${entry.name}`)
    .sort();
  const typedImports = abi.imports
    .map((entry) => `function:${entry.module}:${entry.name}`)
    .sort();
  const actualExports = WebAssembly.Module.exports(module)
    .filter((entry) => entry.kind === 'function')
    .map((entry) => entry.name)
    .sort();
  const typedExports = Object.keys(abi.exports).sort();
  const actualTables = WebAssembly.Module.exports(module)
    .filter((entry) => entry.kind === 'table')
    .map((entry) => entry.name)
    .sort();
  if (
    JSON.stringify(actualImports) !== JSON.stringify(typedImports) ||
    JSON.stringify(actualExports) !== JSON.stringify(typedExports) ||
    JSON.stringify(actualTables) !== JSON.stringify([...abi.tables].sort())
  )
    throw new Error(
      'Disassembled ABI does not cover the actual module imports/exports'
    );
  const transformed = instrumentGlue(
    original,
    abi,
    options.runtimeImport,
    true
  );
  if (
    instrumentGlue(original, abi, options.runtimeImport, false).source !==
    original
  )
    throw new Error('Disabled instrumentation changed shipping glue');
  await writeFile(options.output, transformed.source);
  await writeFile(
    `${options.output}.manifest.json`,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        originalGlueSha256: sha(original),
        measuredGlueSha256: sha(transformed.source),
        wasmSha256: sha(bytes),
        runtimeImport: options.runtimeImport,
        abi,
        apiMethods: transformed.apiMethods,
        physicalImports: transformed.physicalImports,
        physicalExports: transformed.physicalExports,
        payloadHelpers: transformed.payloadHelpers,
        referenceAccounting: {
          costPerSlot: 8,
          label: 'accounting charge, not ABI width',
        },
        disabledGlueByteIdentical: true,
        productionAcceptance: false,
      },
      null,
      2
    )}\n`
  );
}

if (import.meta.main) {
  const [glue, wasm, wasmDis, output] = process.argv.slice(2);
  if (
    glue === undefined ||
    wasm === undefined ||
    wasmDis === undefined ||
    output === undefined
  )
    throw new Error(
      'Usage: bun scripts/measurement/prepare.ts GLUE WASM WASM_DIS OUTPUT'
    );
  await prepareMeasurementGlue({
    glue: resolve(glue),
    wasm: resolve(wasm),
    wasmDis: resolve(wasmDis),
    output: resolve(output),
    runtimeImport: join(
      import.meta.dirname,
      '../../src/measurement/runtime.ts'
    ),
  });
}
