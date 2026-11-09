import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { build } from 'esbuild';
import { expect, it } from 'vitest';
import { prepareMeasurementGlue } from '../../scripts/measurement/prepare';

it('preserves actual session import/output while observing aliases, callbacks, scalars and payloads', async () => {
  const artifact = process.env.MEASUREMENT_ARTIFACT_ROOT;
  const wasmDis = process.env.MEASUREMENT_WASM_DIS;
  if (artifact === undefined || wasmDis === undefined)
    throw new Error(
      'Actual glue test requires MEASUREMENT_ARTIFACT_ROOT and MEASUREMENT_WASM_DIS; no model substitute'
    );
  const dir = await mkdtemp(
    join(process.env.TMPDIR ?? '/tmp', 'compat-measurement-glue-')
  );
  const root = resolve(import.meta.dirname, '../../../..');
  const runtime = resolve(
    import.meta.dirname,
    '../../src/measurement/runtime.ts'
  );
  const metrics = resolve(
    import.meta.dirname,
    '../../src/measurement/metrics.ts'
  );
  const original = join(artifact, 'document_session_wasm.js');
  const validator = resolve(
    import.meta.dirname,
    '../../src/measurement/validate.ts'
  );
  const wasm = join(artifact, 'document_session_wasm_bg.wasm');
  const measured = join(dir, 'measured.mjs');
  await prepareMeasurementGlue({
    glue: original,
    wasm,
    wasmDis,
    output: measured,
    runtimeImport: runtime,
  });
  const source = `
import {readFileSync} from 'node:fs';
import * as original from ${JSON.stringify(original)};
import * as measured from ${JSON.stringify(measured)};
import {AuditRecorder,windowMetrics} from ${JSON.stringify(metrics)};
import {bindAuditRecorder} from ${JSON.stringify(runtime)};
import {validateTrace} from ${JSON.stringify(validator)};
import {SessionConfigMsg,SessionInputMsg,EditorInputMsg,ABI_MAJOR} from ${JSON.stringify(join(root, 'packages/collaboration/src/session/abi.generated.ts'))};
import {emptyInput} from ${JSON.stringify(join(root, 'packages/collaboration/src/session/input.ts'))};
const recorder=new AuditRecorder();
const unbind=bindAuditRecorder(recorder,()=>{throw new Error('No compatBatch in this session-boundary test')});
const bytes=readFileSync(${JSON.stringify(wasm)});
original.initSync({module:bytes}); measured.initSync({module:bytes});
const config=()=>SessionConfigMsg.encode({doc:'boundary-fixture',session:'00000000-0000-0000-0000-000000000001',user:'fixture-user',peers:[7n,8n,9n],access:2,transport:0,durable:false,chatter:false,headless:false,viewEngine:1,viewOs:0,token:'',traceparent:'',coalesce:25,snapshotInterval:0,observed:[]});
const state={root:{type:'root',version:1,children:[{type:'paragraph',version:1,children:[{type:'text',version:1,text:'a😀',format:0,detail:0,mode:'normal',style:''}]}]}};
function run(module,observe){
 const session=module.EditorSession.create(ABI_MAJOR,config(),0,0);
 const outputs=[];
 for(const kind of [0,1]){session.input(SessionInputMsg.encode(emptyInput(kind)),kind,kind);outputs.push([...session.takeOutput()]);}
 const input=SessionInputMsg.encode({...emptyInput(2),editor:EditorInputMsg.fromEditorSetState({json:JSON.stringify(state)})});
 const id=observe?recorder.openWindow('diagnostic','actual-import'):null;
 const flags=session.input(input,2,2);outputs.push([...session.takeOutput()]);
 if(id!==null)recorder.closeWindow(id,true);
 const text=session.textContent();
 const wake=session.wakeAt();
 let ime;
 try{ime={flags:session.compositionEnd(0,'boundary😀',undefined,3)}}catch(error){ime={error:String(error)}}
 outputs.push([...session.takeOutput()]);session.free();
 return {outputs,text,wake,flags,ime,inputLength:input.length};
}
const expected=run(original,false),actual=run(measured,true);
let expectedError,actualError;
try{original.EditorSession.create(999,config(),0,0)}catch(error){expectedError=String(error)}
try{measured.EditorSession.create(999,config(),0,0)}catch(error){actualError=String(error)}
const trace=recorder.snapshot();unbind();
console.log(JSON.stringify({expected,actual,expectedError,actualError,trace,validation:validateTrace(trace),metrics:windowMetrics(trace,1)}));
`;
  const entry = join(dir, 'probe.mjs');
  await build({
    stdin: { contents: source, loader: 'js', resolveDir: root },
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    outfile: entry,
    logLevel: 'silent',
  });
  const raw = execFileSync(process.execPath, [entry], {
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
  });
  const result: unknown = JSON.parse(raw);
  expect(result).toMatchObject({
    expected: { text: 'a😀' },
    actual: { text: 'a😀' },
    metrics: { apiCalls: 2, completed: true },
    validation: [],
  });
  if (
    result === null ||
    typeof result !== 'object' ||
    !('expected' in result) ||
    !('actual' in result) ||
    !('expectedError' in result) ||
    !('actualError' in result)
  )
    throw new Error('Missing actual session results');
  expect(result.actual).toEqual(result.expected);
  expect(result.actualError).toEqual(result.expectedError);
  expect(raw).toContain('__wbindgen_malloc');
  expect(raw).toContain('"kind":"buffer"');
  expect(raw).toContain('"kind":"scalar"');
  expect(raw).toContain('"completed":false');
  expect(raw).toContain('shared-memory.setInt32');
  const manifest = await readFile(`${measured}.manifest.json`, 'utf8');
  await writeFile(
    join(dir, 'proof.json'),
    `${JSON.stringify(
      {
        artifact,
        wasmDis,
        wasmSha256: createHash('sha256')
          .update(await readFile(wasm))
          .digest('hex'),
        originalGlueSha256: createHash('sha256')
          .update(await readFile(original))
          .digest('hex'),
        manifestSha256: createHash('sha256').update(manifest).digest('hex'),
        rawSha256: createHash('sha256').update(raw).digest('hex'),
        productionAcceptance: false,
      },
      null,
      2
    )}\n`
  );
  await writeFile(join(dir, 'raw.json'), raw);
}, 60000);
