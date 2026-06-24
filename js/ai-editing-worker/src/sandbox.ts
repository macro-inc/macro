import releaseSync from '@jitl/quickjs-wasmfile-release-sync';
import wasmModule from '@jitl/quickjs-wasmfile-release-sync/dist/emscripten-module.wasm';
import {
  newQuickJSWASMModuleFromVariant,
  newVariant,
} from 'quickjs-emscripten-core';
import type { DocumentOp } from './ai-editing/editor/ops';
import { SANDBOX_CODE } from './editor-sandbox-code';

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
    const init = ctx.unwrapResult(
      ctx.evalCode(
        `${SANDBOX_CODE}\nconst editor = new DocumentEditor({ validIds: ${JSON.stringify([...validIds])} });\nconst snippets = ${JSON.stringify(snippets ?? {})};`
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
