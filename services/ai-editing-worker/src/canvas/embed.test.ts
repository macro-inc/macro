import { readLoroGraphicsDocument } from '@macro-inc/graphics/loro';
import { getQuickJS } from 'quickjs-emscripten';
import { describe, expect, it } from 'vitest';
import { embedCanvasDocument } from './embed';
import { runCanvasCode } from './sandbox';
import { canvasOpsSchema } from './schema';
import { withCanvasSession } from './session';
import { liveScene } from './test-fixtures';

describe('server-initiated document embeds', () => {
  it('commits a document node and tracks its reference in the same flush', async () => {
    const scene = liveScene();
    try {
      const result = await withCanvasSession(
        scene.source,
        new AbortController().signal,
        (session) =>
          embedCanvasDocument(session, {
            action: 'embed',
            documentId: 'artifact-1',
            name: 'Onboarding',
            fileType: 'artifact',
            subpath: 'empty',
            x: 40,
            y: 60,
            width: 640,
            height: 480,
            mentionId: 'mention-1',
          })
      );

      expect(result.operationsApplied).toBe(1);
      const document = readLoroGraphicsDocument(scene.server, 'scene-root');
      const item = document.items[result.itemId];
      expect(item).toMatchObject({
        type: 'document',
        appearance: {
          fill: 'transparent',
          stroke: 'transparent',
          strokeWidth: 0,
          opacity: 1,
        },
        geometry: {
          documentId: 'artifact-1',
          name: 'Onboarding',
          fileType: 'artifact',
          subpath: 'empty',
          width: 640,
          height: 480,
          display: 'embed',
        },
      });
      expect(
        scene.server.getMap('canvasMentions:canvas-test').toJSON()
      ).toEqual({ 'mention-1': 'artifact-1' });
    } finally {
      scene.server.free();
    }
  });

  it('cannot be produced by agent snippets', async () => {
    const QuickJS = await getQuickJS();
    expect(() =>
      runCanvasCode(
        QuickJS,
        `editor.embedDocument({documentId:'artifact-1',name:'x',fileType:'artifact',x:0,y:0,width:10,height:10})`
      )
    ).toThrow();
    expect(() =>
      runCanvasCode(
        QuickJS,
        `editor.ops.push({kind:'embedDocument',id:'x',documentId:'artifact-1',name:'x',fileType:'artifact',x:0,y:0,width:10,height:10})`
      )
    ).toThrow();
    expect(
      canvasOpsSchema.safeParse([
        {
          kind: 'embedDocument',
          id: 'x',
          documentId: 'artifact-1',
          name: 'x',
          fileType: 'artifact',
          x: 0,
          y: 0,
          width: 10,
          height: 10,
        },
      ]).success
    ).toBe(false);
  });
});
