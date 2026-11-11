import { execFileSync } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { build } from 'esbuild';
import { expect, it } from 'vitest';
import type { ModuleAbi } from '../../scripts/measurement/abi';
import { instrumentGlue } from '../../scripts/measurement/glue';
import { prepareMeasurementGlue } from '../../scripts/measurement/prepare';

// Synthetic WASM copy boundary only: this is not an editor or a compatibility engine.
const source = `
let wasm; let WASM_VECTOR_LEN=0; let cachedUint8ArrayMemory0=null;
function getUint8ArrayMemory0(){if(cachedUint8ArrayMemory0===null||cachedUint8ArrayMemory0.byteLength===0){cachedUint8ArrayMemory0=new Uint8Array(wasm.memory.buffer);}return cachedUint8ArrayMemory0;}
function getArrayU8FromWasm0(ptr,len){ptr=ptr>>>0;return getUint8ArrayMemory0().subarray(ptr/1,ptr/1+len);}
function passArray8ToWasm0(arg){WASM_VECTOR_LEN=arg.length;return 0;}
function passStringToWasm0(arg){WASM_VECTOR_LEN=arg.length;return 0;}
function decodeText(ptr,len){return '';}
function __wbg_finalize_init(instance){wasm=instance.exports;return wasm;}
function __wbg_get_imports(){const import0={__wbg_new_from_slice_fixture:function(arg0,arg1){const ret=new Uint8Array(getArrayU8FromWasm0(arg0,arg1));return ret;}};return {'host':import0};}
export function imports(){return __wbg_get_imports();}
export function initialize(instance){__wbg_finalize_init(instance);}
export function capture(ptr,len){return wasm.copy(ptr,len);}
`;
const abi: ModuleAbi = {
  imports: [
    {
      module: 'host',
      name: '__wbg_new_from_slice_fixture',
      parameters: ['i32', 'i32'],
      results: ['externref'],
    },
  ],
  exports: { copy: { parameters: ['i32', 'i32'], results: ['externref'] } },
  tables: [],
};

it('rejects constructor, helper, shadow and ABI variants rather than treating arbitrary views as copies', () => {
  const valid = instrumentGlue(source, abi, 'runtime', true);
  expect(valid.payloadHelpers).toContain('getArrayU8FromWasm0.copy');
  expect(valid.source.match(/getArrayU8FromWasm0\.copy/g)).toHaveLength(1);
  const invalid = [
    source.replace('const ret=new Uint8Array(', 'const ret=new Uint16Array('),
    source.replace(
      'const ret=new Uint8Array(',
      'const alias=getArrayU8FromWasm0;const ret=new Uint8Array('
    ),
    source.replace(
      'cachedUint8ArrayMemory0=null;',
      'cachedUint8ArrayMemory0=other;'
    ),
    source.replace(
      'getArrayU8FromWasm0(arg0,arg1));',
      'getArrayU8FromWasm0(arg0,arg1),0);'
    ),
    source.replace(
      'const ret=new Uint8Array(',
      'const Uint8Array=Other;const ret=new Uint8Array('
    ),
    source.replace(
      'const ret=new Uint8Array(',
      'const getArrayU8FromWasm0=other;const ret=new Uint8Array('
    ),
    source.replace('.subarray(ptr/1,ptr/1+len)', '.slice(ptr/1,ptr/1+len)'),
    source.replace(
      'return getUint8ArrayMemory0()',
      'return\ngetUint8ArrayMemory0()'
    ),
    source.replace(
      'return cachedUint8ArrayMemory0;',
      'return\ncachedUint8ArrayMemory0;'
    ),
    source.replace(
      'new Uint8Array(wasm.memory.buffer)',
      'new Uint8Array(other.buffer)'
    ),
    source.replace("return {'host':import0}", "return {'wrong':import0}"),
    source.replace(
      'getArrayU8FromWasm0(arg0,arg1));',
      'getArrayU8FromWasm0(arg1,arg0));'
    ),
  ];
  for (const text of invalid) {
    expect(text).not.toBe(source);
    expect(() => instrumentGlue(text, abi, 'runtime', true)).toThrow();
  }
  for (const signature of [
    { parameters: ['externref', 'i32'], results: ['externref'] },
    { parameters: ['i32', 'i32'], results: ['i32'] },
  ])
    expect(() =>
      instrumentGlue(
        source,
        { ...abi, imports: [{ ...abi.imports[0], ...signature }] },
        'runtime',
        true
      )
    ).toThrow('ABI import');
  expect(instrumentGlue(source, abi, 'must-not-import', false).source).toBe(
    source
  );
});

it('counts actual copied bytes once across a real synthetic WASM import, preserving identity and opaque throws', async () => {
  const wasmDis = process.env.MEASUREMENT_WASM_DIS;
  if (!wasmDis)
    throw new Error(
      'Synthetic WASM copy test requires the actual wasm-dis tool'
    );
  const dir = await mkdtemp(
    join(process.env.TMPDIR ?? '/tmp', 'compat-copy-boundary-')
  );
  const wat = join(dir, 'copy.wat');
  const wasm = join(dir, 'copy.wasm');
  await writeFile(
    wat,
    `(module
 (import "host" "__wbg_new_from_slice_fixture" (func $copy (param i32 i32) (result externref)))
 (memory $memory 1)
 (export "memory" (memory $memory))
 (func $entry (param $ptr i32) (param $len i32) (result externref) (call $copy (local.get $ptr) (local.get $len)))
 (export "copy" (func $entry))
)`
  );
  execFileSync(join(dirname(wasmDis), 'wasm-as'), [
    '--enable-reference-types',
    wat,
    '-o',
    wasm,
  ]);
  const original = join(dir, 'original.mjs');
  const measured = join(dir, 'measured.mjs');
  await writeFile(original, source);
  const runtime = resolve(
    import.meta.dirname,
    '../../src/measurement/runtime.ts'
  );
  await prepareMeasurementGlue({
    glue: original,
    wasm,
    wasmDis,
    output: measured,
    runtimeImport: runtime,
  });
  const entry = `
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import * as original from ${JSON.stringify(original)};
import * as measured from ${JSON.stringify(measured)};
import {AuditRecorder} from ${JSON.stringify(resolve(import.meta.dirname, '../../src/measurement/metrics.ts'))};
import {bindAuditRecorder} from ${JSON.stringify(runtime)};
import {validateTrace} from ${JSON.stringify(resolve(import.meta.dirname, '../../src/measurement/validate.ts'))};
const recorder=new AuditRecorder();const unbind=bindAuditRecorder(recorder,()=>false);
const module=new WebAssembly.Module(readFileSync(${JSON.stringify(wasm)}));
function run(glue){
 const instance=new WebAssembly.Instance(module,glue.imports());glue.initialize(instance);
 const Native=Uint8Array;new Native(instance.exports.memory.buffer).set([17,34],65534);
 const opaque=Object.freeze({opaque:true}),accessor=Object.freeze({accessor:true});
 let fail=false,lastCopy,copyAttempts=0,accessorCalls=0;
 globalThis.Uint8Array=new Proxy(Native,{construct(target,args,newTarget){
  if(ArrayBuffer.isView(args[0])){copyAttempts++;if(fail)throw opaque;}
  const result=Reflect.construct(target,args,newTarget);
  if(ArrayBuffer.isView(args[0])){lastCopy=result;Object.defineProperty(result,'byteLength',{get(){accessorCalls++;throw accessor;}});}
  return result;
 }});
 try{
  const result=glue.capture(65534,99);assert.equal(result,lastCopy);assert.deepEqual([...result],[17,34]);
  result[0]=9;assert.equal(new Native(instance.exports.memory.buffer)[65534],17);
  fail=true;assert.throws(()=>glue.capture(0,4),(error)=>error===opaque);
  assert.equal(copyAttempts,2);assert.equal(accessorCalls,0);
  return {output:[...result],copyAttempts,accessorCalls};
 }finally{globalThis.Uint8Array=Native;}
}
const baseline=run(original),observed=run(measured);assert.deepEqual(observed,baseline);
const trace=recorder.snapshot();assert.deepEqual(validateTrace(trace),[]);unbind();
assert.equal(trace.calls.filter(call=>call.layer==='api').length,2);
assert.equal(trace.calls.filter(call=>call.layer==='physical').length,4);
const payload=trace.bytes.filter(event=>event.kind==='buffer');
assert.equal(payload.length,1);assert.equal(payload[0].bytes,2);assert.equal(payload[0].direction,'wasm-to-js');
assert.equal(payload[0].method,'getArrayU8FromWasm0.copy');
writeFileSync(${JSON.stringify(join(dir, 'observations.json'))},JSON.stringify({classification:'synthetic-wasm-copy-only',nativeAcceptance:false,baseline,observed,trace},null,2));
console.log(JSON.stringify({classification:'synthetic-wasm-copy-only',nativeAcceptance:false,baseline,observed,payload}));
`;
  const out = join(dir, 'run.mjs');
  await build({
    stdin: { contents: entry, loader: 'ts', resolveDir: import.meta.dirname },
    bundle: true,
    platform: 'node',
    format: 'esm',
    outfile: out,
  });
  const result: unknown = JSON.parse(
    execFileSync(process.execPath, [out], { encoding: 'utf8' })
  );
  expect(result).toMatchObject({
    classification: 'synthetic-wasm-copy-only',
    nativeAcceptance: false,
    observed: { output: [9, 34], copyAttempts: 2, accessorCalls: 0 },
  });
});
