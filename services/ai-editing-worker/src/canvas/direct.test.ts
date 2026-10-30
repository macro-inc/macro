import { fitTextLayout } from '@macro-inc/graphics';
import { describe, expect, it, vi } from 'vitest';
import { canvasRevision } from './revision';
import { withCanvasSession } from './session';
import { liveScene } from './test-fixtures';

vi.mock('../sandbox', async () => {
  const { getQuickJS } = await import('quickjs-emscripten');
  const { runCanvasCode } = await import('./sandbox');
  return {
    runCanvasInSandbox: async (
      code: string,
      snippets?: Record<string, string>
    ) => runCanvasCode(await getQuickJS(), code, snippets),
  };
});
const { applyCanvasCode } = await import('./direct');
describe('main agent direct batches', () => {
  it('executes a real sandbox batch, measures, ACKs once and rejects stale retries without a model', async () => {
    const scene = liveScene();
    const signal = new AbortController().signal;
    try {
      await withCanvasSession(scene.source, signal, async (session) => {
        const revision = await canvasRevision(session.snapshot());
        const result = await applyCanvasCode(
          session,
          {
            expectedRevision: revision,
            code: 'editor.create({type:"rectangle",x:0,y:0,text:snippets.label,fontSize:22}); editor.create({type:"ellipse",x:500,y:0,text:snippets.label,fontSize:22}); return {planned:true}',
            snippets: { label: 'Readable wrapped content' },
          },
          async (snapshot, requests) =>
            fitTextLayout(snapshot.document, requests, () => ({
              width: 200,
              height: 160,
            })),
          signal
        );
        expect(result.operationsApplied).toBe(2);
        expect(result.usage).toEqual([]);
        const read = JSON.parse(result.canvas);
        expect(read.revision).toBe(await canvasRevision(session.snapshot()));
        expect(read.revision).not.toBe(revision);
        expect(read.textLayout).toHaveLength(2);
        expect(
          read.textLayout.every(
            (effect: { overflow: boolean; fontSize: number }) =>
              !effect.overflow && effect.fontSize === 22
          )
        ).toBe(true);
        expect(scene.writes()).toBe(1);
        await expect(
          applyCanvasCode(
            session,
            { expectedRevision: revision, code: 'editor.delete([])' },
            async (snapshot) => ({ document: snapshot.document, effects: [] }),
            signal
          )
        ).rejects.toThrow('revision changed');
        expect(scene.writes()).toBe(1);
      });
    } finally {
      scene.server.free();
    }
  });
  it('rejects a later invalid command atomically and bounds CPU', async () => {
    const scene = liveScene();
    const signal = new AbortController().signal;
    try {
      await withCanvasSession(scene.source, signal, async (session) => {
        const expectedRevision = await canvasRevision(session.snapshot());
        const measure = async (
          snapshot: ReturnType<typeof session.snapshot>
        ) => ({ document: snapshot.document, effects: [] });
        await expect(
          applyCanvasCode(
            session,
            {
              expectedRevision,
              code: 'editor.create({type:"rectangle",x:0,y:0}); editor.move(["missing"],0,20)',
            },
            measure,
            signal
          )
        ).rejects.toThrow();
        await expect(
          applyCanvasCode(
            session,
            { expectedRevision, code: 'while(true){}' },
            measure,
            signal
          )
        ).rejects.toThrow();
        expect(scene.writes()).toBe(0);
      });
    } finally {
      scene.server.free();
    }
  });
});
