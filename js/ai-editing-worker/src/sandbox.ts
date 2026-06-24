import releaseSync from '@jitl/quickjs-wasmfile-release-sync';
import wasmModule from '@jitl/quickjs-wasmfile-release-sync/dist/emscripten-module.wasm';
import { nanoid } from 'nanoid';
import {
  newQuickJSWASMModuleFromVariant,
  newVariant,
} from 'quickjs-emscripten-core';
import type { DocumentOp } from './ai-editing/editor/ops';
import { SANDBOX_CODE } from './editor-sandbox-code';

/** Upper bound on inserts per snippet. The host mints the ids (QuickJS has no
 *  good entropy), pre-generating this many globally-unique ones per run. */
const REF_POOL_SIZE = 128;

// Verbatim from their docs:
// Create a new variant by overriding how Emscripten obtains the WebAssembly
// module. This may be necessary in Cloudflare Workers, which can’t compile
// WebAssembly modules from binary data.
// Magic that makes cloudflare happy :)
const variant = newVariant(releaseSync, { wasmModule });

let _qjs: Awaited<ReturnType<typeof newQuickJSWASMModuleFromVariant>> | null =
  null;

async function qjs() {
  if (!_qjs) _qjs = await newQuickJSWASMModuleFromVariant(variant);
  return _qjs;
}

export async function runInSandbox(
  validIds: Set<string>,
  code: string,
  snippets?: Record<string, string>
): Promise<DocumentOp[]> {
  const QuickJS = await qjs();
  const ctx = QuickJS.newContext();
  try {
    const refs = Array.from({ length: REF_POOL_SIZE }, () => nanoid());
    const init = ctx.unwrapResult(
      ctx.evalCode(
        `${SANDBOX_CODE}\nconst editor = new DocumentEditor({ validIds: ${JSON.stringify([...validIds])}, refs: ${JSON.stringify(refs)} });\nconst snippets = ${JSON.stringify(snippets ?? {})};`
      )
    );
    init.dispose();

    const run = ctx.unwrapResult(ctx.evalCode(code));
    run.dispose();

    const out = ctx.unwrapResult(
      ctx.evalCode('JSON.stringify(editor.drain())')
    );
    const json = ctx.dump(out) as string;
    out.dispose();
    return JSON.parse(json) as DocumentOp[];
  } finally {
    ctx.dispose();
  }
}
