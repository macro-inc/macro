import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { build } from 'esbuild';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import {
  HOST_BODY_SHA256,
  instrumentCompatibilityHost,
} from '../../scripts/measurement/host';
import { AuditRecorder } from '../../src/measurement/metrics';
import { bindAuditRecorder, measureApi } from '../../src/measurement/runtime';
import { validateTrace } from '../../src/measurement/validate';

const root = process.env.MEASUREMENT_HOST_SOURCE_ROOT;
if (root === undefined)
  throw new Error(
    'Host source proof requires MEASUREMENT_HOST_SOURCE_ROOT; no fixture substitutes'
  );
const hostPath = resolve(
  root,
  'packages/lexical-wasm-shim/src/backend/production/host.ts'
);
const original = readFileSync(hostPath, 'utf8');
const originalFile = ts.createSourceFile(
  hostPath,
  original,
  ts.ScriptTarget.Latest,
  true
);
const dispatcher = originalFile.statements.find(
  (node): node is ts.FunctionDeclaration =>
    ts.isFunctionDeclaration(node) &&
    node.name?.text === 'dispatchCompatibilityHost'
);
if (!dispatcher?.body) throw new Error('Actual host dispatcher is unavailable');
const declaration = dispatcher.getText(originalFile);
const runtimePath = resolve(
  import.meta.dirname,
  '../../src/measurement/runtime.ts'
);
const sha = (source: string): string =>
  createHash('sha256').update(source).digest('hex');

describe('host API measurement direction', () => {
  it('keeps legacy calls JS-to-WASM and explicitly counts callbacks WASM-to-JS with zero API bytes', () => {
    const recorder = new AuditRecorder();
    const unbind = bindAuditRecorder(recorder, () => false);
    const value = Object.freeze({ exact: true });
    const opaque = Object.freeze({ opaque: true });
    const effects: string[] = [];
    try {
      const id = recorder.openWindow('diagnostic', 'direction-overload');
      expect(measureApi('legacy', 'operation', () => value)).toBe(value);
      const bound = measureApi.bind(null, 'legacy-bound', 'operation');
      expect(bound(() => value)).toBe(value);
      expect(
        measureApi('explicit-out', 'js-to-wasm', 'operation', () => 7)
      ).toBe(7);
      let caught: unknown;
      try {
        measureApi('callback', 'wasm-to-js', 'operation', () => {
          try {
            effects.push('body');
            throw opaque;
          } finally {
            effects.push('finally');
          }
        });
      } catch (error) {
        caught = error;
      }
      expect(caught).toBe(opaque);
      recorder.closeWindow(id, true);
      const trace = recorder.snapshot();
      expect(validateTrace(trace)).toEqual([]);
      expect(
        trace.calls.map((call) => [call.method, call.direction, call.completed])
      ).toEqual([
        ['legacy', 'js-to-wasm', true],
        ['legacy-bound', 'js-to-wasm', true],
        ['explicit-out', 'js-to-wasm', true],
        ['callback', 'wasm-to-js', false],
      ]);
      expect(trace.bytes).toEqual([]);
      expect(trace.references).toEqual([]);
      expect(effects).toEqual(['body', 'finally']);
    } finally {
      unbind();
    }
  });
});

it('rejects invalid overload directions and retains generic return types in ordinary TypeScript', async () => {
  const dir = await mkdtemp(
    join(process.env.TMPDIR ?? '/tmp', 'compat-host-types-')
  );
  const entry = join(dir, 'overloads.ts');
  await writeFile(
    entry,
    `import {measureApi} from ${JSON.stringify(runtimePath)};
const legacy:number=measureApi('legacy','operation',()=>7);
const callback:number=measureApi('callback','wasm-to-js','operation',()=>7);
const wrong:number=measureApi('wrong','wasm-to-js','operation',()=>'text');
measureApi('wrong','sideways','operation',()=>7);
measureApi('wrong','wasm-to-js',()=>7);
measureApi('wrong','operation','wasm-to-js',()=>7);
`
  );
  const configPath = resolve(import.meta.dirname, '../../tsconfig.json');
  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  if (config.error)
    throw new Error('Cannot read actual measurement compiler options');
  const parsed = ts.parseJsonConfigFileContent(
    config.config,
    ts.sys,
    resolve(import.meta.dirname, '../..')
  );
  const program = ts.createProgram([entry], parsed.options);
  const errors = ts.getPreEmitDiagnostics(program);
  expect(errors.map((error) => error.code).sort()).toEqual([
    2322, 2345, 2345, 2345,
  ]);
  expect(errors.every((error) => error.file?.fileName === entry)).toBe(true);
});

describe('strict diagnostic host transform', () => {
  it('returns even malformed future source byte-identically when disabled', () => {
    const source = '\uFEFF// unknown future host\r\nnot valid TS \u0000';
    expect(
      instrumentCompatibilityHost(source, 'must-not-import', false)
    ).toEqual({ source, apiMethods: [] });
  });

  it('keeps the exported declaration and unrelated callback bridge untouched', () => {
    const result = instrumentCompatibilityHost(original, runtimePath, true);
    expect(result.apiMethods).toEqual(['dispatchCompatibilityHost']);
    expect(result.source.match(/__audit\.measureApi\(/g)).toHaveLength(1);
    const file = ts.createSourceFile(
      'measured.ts',
      result.source,
      ts.ScriptTarget.Latest,
      true
    );
    expect(
      file.statements.filter(
        (node) =>
          ts.isFunctionDeclaration(node) &&
          node.name?.text === 'dispatchCompatibilityHost'
      )
    ).toHaveLength(1);
    const before = originalFile.statements.find(
      (node) =>
        ts.isFunctionDeclaration(node) &&
        node.name?.text === 'callCompatibilityScope'
    );
    const after = file.statements.find(
      (node) =>
        ts.isFunctionDeclaration(node) &&
        node.name?.text === 'callCompatibilityScope'
    );
    if (!before || !after) throw new Error('Actual callback bridge is missing');
    expect(after.getText(file)).toBe(before.getText(originalFile));
    expect(() =>
      instrumentCompatibilityHost(result.source, runtimePath, true)
    ).toThrow('audit binding');
    expect(
      instrumentCompatibilityHost(
        original.replaceAll('\n', '\r\n'),
        runtimePath,
        true
      ).apiMethods
    ).toHaveLength(1);
  });

  it('rejects unsupported signatures, bodies, duplicate exports, aliases and binding collisions', () => {
    const changed = [
      original.replace(
        'export function dispatchCompatibilityHost(',
        'export async function dispatchCompatibilityHost('
      ),
      original.replace(
        'export function dispatchCompatibilityHost(',
        'export function* dispatchCompatibilityHost('
      ),
      original.replace(
        'hostSlot: number,\n  bytes:',
        'hostSlot?: number,\n  bytes:'
      ),
      original.replace(
        'hostSlot: number,\n  bytes:',
        'hostSlot: number = 1,\n  bytes:'
      ),
      original.replace(
        'hostSlot: number,\n  bytes:',
        'slot: number,\n  bytes:'
      ),
      original.replace(
        'bytes: Uint8Array\n): Uint8Array',
        'bytes: unknown\n): Uint8Array'
      ),
      original.replace(
        '): Uint8Array {\n  const entry = hosts.get(hostSlot);',
        '): unknown {\n  const entry = hosts.get(hostSlot);'
      ),
      original.replace('activeScope = previous;', 'activeScope = undefined;'),
      original.replace(
        'return CompatHostReply.encode',
        'return\nCompatHostReply.encode'
      ),
      `${original}\n${declaration}`,
      `${original}\nexport { dispatchCompatibilityHost };`,
      `${original}\nconst __audit = {};`,
      original.replace(
        'export function dispatchCompatibilityHost(',
        'export function renamedHost('
      ),
    ];
    for (const source of changed) {
      expect(source).not.toBe(original);
      expect(() =>
        instrumentCompatibilityHost(source, runtimePath, true)
      ).toThrow();
    }
    expect(() =>
      instrumentCompatibilityHost('export function {', runtimePath, true)
    ).toThrow();
  });

  it('compiles the actual production host overlay against actual generated types and the real runtime', async () => {
    const measured = instrumentCompatibilityHost(original, runtimePath, true);
    const configPath = resolve(
      root,
      'packages/lexical-wasm-shim/tsconfig.json'
    );
    const config = ts.readConfigFile(configPath, ts.sys.readFile);
    if (config.error)
      throw new Error(
        ts.flattenDiagnosticMessageText(config.error.messageText, '\n')
      );
    const parsed = ts.parseJsonConfigFileContent(
      config.config,
      ts.sys,
      resolve(root, 'packages/lexical-wasm-shim')
    );
    const host = ts.createCompilerHost(parsed.options);
    const read = host.readFile.bind(host);
    host.readFile = (name) =>
      resolve(name) === hostPath ? measured.source : read(name);
    const program = ts.createProgram(
      [hostPath, runtimePath],
      parsed.options,
      host
    );
    const diagnostics = ts.getPreEmitDiagnostics(program);
    expect(
      diagnostics.map((entry) =>
        ts.flattenDiagnosticMessageText(entry.messageText, '\n')
      )
    ).toEqual([]);
    const dir = await mkdtemp(
      join(process.env.TMPDIR ?? '/tmp', 'compat-host-overlay-')
    );
    await writeFile(
      join(dir, 'proof.json'),
      JSON.stringify(
        {
          classification: 'actual-source-typecheck-only',
          nativeAcceptance: false,
          sourceHost: hostPath,
          originalHostSha256: sha(original),
          measuredHostSha256: sha(measured.source),
          approvedBodySha256: HOST_BODY_SHA256,
          compiler: ts.version,
          compilerImplementationSha256: sha(
            readFileSync(
              resolve(
                import.meta.dirname,
                '../../node_modules/typescript/lib/typescript.js'
              ),
              'utf8'
            )
          ),
          sourceFiles: program
            .getSourceFiles()
            .filter((file) => !program.isSourceFileDefaultLibrary(file))
            .map((file) => ({ path: file.fileName, sha256: sha(file.text) })),
        },
        null,
        2
      )
    );
  });

  it('preserves synthetic nested returns, opaque throws, finally order and stable function identity', async () => {
    const dir = await mkdtemp(
      join(process.env.TMPDIR ?? '/tmp', 'compat-host-synthetic-')
    );
    const prefix = `
const hosts = new Map(); let activeScope = {outside:true};
const requests = new Map(); const CompatHostAccess = {Unknown:0};
const CompatHostRequest = {decode(bytes){return requests.get(bytes)}};
const CompatHostReply = {encode(reply){return reply.result}};
`;
    const harness = `
import assert from 'node:assert/strict';
import {AuditRecorder} from ${JSON.stringify(resolve(import.meta.dirname, '../../src/measurement/metrics.ts'))};
import {bindAuditRecorder,measurePhysical} from ${JSON.stringify(runtimePath)};
import {validateTrace} from ${JSON.stringify(resolve(import.meta.dirname, '../../src/measurement/validate.ts'))};
const recorder=new AuditRecorder(); const unbind=bindAuditRecorder(recorder,()=>false);
const outside=activeScope; const opaque=Object.freeze({opaque:true}); const effects=[];
const input=new Uint8Array([1]); const inner=new Uint8Array([2]); let fail=false;
const context=(hostSlot)=>({hostSlot,scopeId:BigInt(hostSlot),editorId:1,access:1});
requests.set(input,{context:context(1),delta:{}}); requests.set(inner,{context:context(2),delta:{}});
const invoke=(slot,bytes)=>measurePhysical('synthetic.__wbg_call','wasm-to-js',0,0,0,0,()=>dispatchCompatibilityHost(slot,bytes));
const runtime=(slot)=>({applyDelta(){effects.push(slot+'delta')},applyMetadata(){effects.push(slot+'metadata')},dispatch(){
 effects.push(slot+'dispatch'); assert.equal(activeScope.context.hostSlot,slot);
 if(slot===1){const prior=activeScope;invoke(2,inner);assert.equal(activeScope,prior);return new Uint8Array([7]);}
 if(fail)throw opaque;return new Uint8Array([8]);
}});
const outerRuntime=runtime(1),innerRuntime=runtime(2);
hosts.set(1,{runtime:new WeakRef(outerRuntime)});hosts.set(2,{runtime:new WeakRef(innerRuntime)});
const identity=dispatchCompatibilityHost;
const output=invoke(1,input);assert.deepEqual([...output],[7]);assert.equal(activeScope,outside);
fail=true;assert.throws(()=>invoke(1,input),(error)=>error===opaque);assert.equal(activeScope,outside);
assert.equal(dispatchCompatibilityHost,identity);
const trace=recorder.snapshot();assert.deepEqual(validateTrace(trace),[]);unbind();
assert.deepEqual(effects,['1delta','1metadata','1dispatch','2delta','2metadata','2dispatch','1delta','1metadata','1dispatch','2delta','2metadata','2dispatch']);
assert.equal(trace.calls.filter(call=>call.layer==='physical').length,4);
assert.deepEqual(trace.bytes,[]);assert.deepEqual(trace.references,[]);
/* COUNTER_ASSERTIONS */
console.log(JSON.stringify({classification:'synthetic-transform-only',nativeAcceptance:false,output:[...output],effects,trace}));
`;
    const observed: unknown[] = [];
    for (const enabled of [false, true]) {
      const source =
        instrumentCompatibilityHost(prefix + declaration, runtimePath, enabled)
          .source +
        harness.replace(
          '/* COUNTER_ASSERTIONS */',
          `
assert.equal(trace.calls.filter(call=>call.layer==='api').length,${enabled ? 4 : 0});
assert.ok(trace.calls.filter(call=>call.layer==='api').every(call=>call.direction==='wasm-to-js'&&call.category==='operation'));
assert.equal(trace.calls.filter(call=>call.layer==='api'&&!call.completed).length,${enabled ? 2 : 0});
`
        );
      const out = join(dir, enabled ? 'measured.mjs' : 'original.mjs');
      await build({
        stdin: {
          contents: source,
          loader: 'ts',
          resolveDir: import.meta.dirname,
        },
        bundle: true,
        platform: 'node',
        format: 'esm',
        outfile: out,
      });
      const result: unknown = JSON.parse(
        execFileSync(process.execPath, [out], { encoding: 'utf8' })
      );
      observed.push(result);
    }
    expect(observed[0]).toMatchObject({
      output: [7],
      classification: 'synthetic-transform-only',
      nativeAcceptance: false,
    });
    expect(observed[1]).toMatchObject({
      output: [7],
      classification: 'synthetic-transform-only',
      nativeAcceptance: false,
    });
    const baseline = JSON.stringify(observed[0]);
    const measured = JSON.stringify(observed[1]);
    expect(baseline).toContain('1delta');
    expect(measured).toContain('dispatchCompatibilityHost');
    await writeFile(
      join(dir, 'synthetic-observations.json'),
      JSON.stringify(observed, null, 2)
    );
  });
});
