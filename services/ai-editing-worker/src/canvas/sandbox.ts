import { nanoid } from 'nanoid';
import type { QuickJSWASMModule } from 'quickjs-emscripten-core';
import { CANVAS_SANDBOX_CODE } from './sandbox-code';
import { canvasOpsSchema } from './schema';

/** No host callbacks or I/O; both execution time and memory are bounded. */
export function runCanvasCode(
  QuickJS: QuickJSWASMModule,
  code: string,
  snippets?: Record<string, string>
) {
  if (code.length > 50_000)
    throw new Error('Canvas snippets may contain at most 50000 characters.');
  const runtime = QuickJS.newRuntime();
  runtime.setMemoryLimit(16 * 1024 * 1024);
  runtime.setMaxStackSize(512 * 1024);
  const deadline = Date.now() + 1000;
  runtime.setInterruptHandler(() => Date.now() > deadline);
  const ctx = runtime.newContext();
  try {
    const refs = Array.from({ length: 100 }, () => nanoid());
    const init = ctx.unwrapResult(
      ctx.evalCode(
        `${CANVAS_SANDBOX_CODE}\nconst editor = new CanvasEditor(${JSON.stringify(refs)}); const snippets = JSON.parse(${JSON.stringify(JSON.stringify(snippets ?? {}))});`
      )
    );
    init.dispose();
    const result = ctx.unwrapResult(ctx.evalCode(`(() => {\n${code}\n})()`));
    result.dispose();
    const out = ctx.unwrapResult(
      ctx.evalCode('JSON.stringify(editor.drain())')
    );
    const json: unknown = ctx.dump(out);
    out.dispose();
    if (typeof json !== 'string' || json.length > 512_000)
      throw new Error('Canvas operation output too large.');
    const ops = canvasOpsSchema.parse(JSON.parse(json));
    const minted = new Set(refs);
    const created = new Set<string>();
    for (const op of ops) {
      if (op.kind !== 'create' && op.kind !== 'connect' && op.kind !== 'group')
        continue;
      if (!minted.has(op.id) || created.has(op.id))
        throw new Error(
          'New Canvas IDs must come from this snippet’s host-generated pool.'
        );
      created.add(op.id);
    }
    return ops;
  } finally {
    ctx.dispose();
    runtime.dispose();
  }
}
