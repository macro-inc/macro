import { getQuickJS } from 'quickjs-emscripten';
import { describe, expect, it } from 'vitest';
import type { DocumentOp } from '.';
import { SANDBOX_CODE } from '../../editor-sandbox-code';
import { sandboxInit } from './sandbox-init';

/** Runs a snippet through real QuickJS, as production does. `src/sandbox.ts`
 *  imports the emscripten wasm in a way only wrangler's bundler resolves, so the
 *  test loads the engine via the stock loader instead. */
async function runSnippet(
  validIds: Set<string>,
  code: string
): Promise<DocumentOp[]> {
  const QuickJS = await getQuickJS();
  const ctx = QuickJS.newContext();
  try {
    const refs = Array.from({ length: 8 }, (_, i) => `ref-${i}`);
    ctx.unwrapResult(
      ctx.evalCode(`${SANDBOX_CODE}\n${sandboxInit(validIds, refs, undefined)}`)
    ).dispose();
    ctx.unwrapResult(ctx.evalCode(code)).dispose();
    const out = ctx.unwrapResult(ctx.evalCode('JSON.stringify(editor.drain())'));
    const json = ctx.dump(out) as string;
    out.dispose();
    return JSON.parse(json) as DocumentOp[];
  } finally {
    ctx.dispose();
  }
}

/**
 * Writers reach for plausible-but-absent editor methods. Across 622 prod traces
 * there are 21 such calls over 12 names, split between missing insert variants
 * (`insertListAfter`, `appendListItemAfter`, `insertEquationAfter`) and attempts
 * to READ the document from inside the snippet (`getText`, `getNode`,
 * `getBlock`, `readBlock`, `lastListItem`) — the editor is write-only.
 *
 * A bare `editor.getText is not a function` names the mistake but not the way
 * out, so the next call is another guess.
 */
const ids = new Set(['n1']);

async function failureFor(code: string): Promise<string> {
  try {
    await runSnippet(ids, code);
    return '<no error>';
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

describe('unknown editor methods', () => {
  it('still runs a real method', async () => {
    const ops = await runSnippet(ids, `editor.setText('n1', 'x');`);
    expect(ops).toEqual([{ kind: 'setText', node: 'n1', text: 'x' }]);
  });

  it('says the method does not exist', async () => {
    expect(await failureFor(`editor.getText('n1');`)).toMatch(
      /editor\.getText does not exist/
    );
  });

  it('suggests the closest real method', async () => {
    const msg = await failureFor(`editor.appendListItemAfter('n1', 'x');`);
    expect(msg).toMatch(/Did you mean/);
    expect(msg).toMatch(/appendListItem/);
  });

  it('suggests insert variants for a missing one', async () => {
    const msg = await failureFor(`editor.insertListAfter('n1', 'x');`);
    expect(msg).toMatch(/Did you mean/);
  });

  it('points read attempts at the readDocument tool', async () => {
    expect(await failureFor(`editor.getBlock('n1');`)).toMatch(
      /write-only.*readDocument/s
    );
  });

  it('keeps real methods bound so chaining still works', async () => {
    const ops = await runSnippet(
      ids,
      `editor.setText('n1', 'a'); editor.bold('n1', 'a');`
    );
    expect(ops).toHaveLength(2);
  });

  it('does not intercept ordinary property reads', async () => {
    // `drain` is called by the host after the snippet; the proxy must not break it.
    const ops = await runSnippet(ids, `editor.setText('n1', 'ok');`);
    expect(Array.isArray(ops)).toBe(true);
  });
});
