import { worldBounds } from '@macro-inc/graphics';
import { readLoroGraphicsDocument } from '@macro-inc/graphics/loro';
import { getQuickJS } from 'quickjs-emscripten';
import { describe, expect, it } from 'vitest';
import { embedCanvasDocument } from './embed';
import { runCanvasCode } from './sandbox';
import { canvasOpsSchema } from './schema';
import { withCanvasSession } from './session';
import { liveScene } from './test-fixtures';

const ITEM_ID = '0193f3a4-7d1e-7c2a-9f00-0000000001e7';
const MENTION_ID = '0193f3a4-7d1e-7c2a-9f00-00000000ae17';
const EMBED = {
  action: 'embed',
  itemId: ITEM_ID,
  documentId: 'artifact-1',
  name: 'Onboarding',
  fileType: 'artifact',
  x: 40,
  y: 60,
  width: 640,
  height: 480,
  mentionId: MENTION_ID,
} as const;

describe('server-initiated document embeds', () => {
  it('repeats as a no-op: one node, left where it was, and one tracked mention', async () => {
    const scene = liveScene();
    try {
      await withCanvasSession(
        scene.source,
        new AbortController().signal,
        async (session) => {
          await embedCanvasDocument(session, EMBED);
          await session.apply([
            { kind: 'move', ids: [ITEM_ID], dx: 100, dy: 0 },
          ]);
          await embedCanvasDocument(session, EMBED);
        }
      );

      const document = readLoroGraphicsDocument(scene.server, 'scene-root');
      const documents = Object.values(document.items).filter(
        (item) => item.type === 'document'
      );
      expect(documents.map((item) => item.id)).toEqual([ITEM_ID]);
      expect(worldBounds(document, ITEM_ID).x).toBe(140);
      expect(
        scene.server.getMap('canvasMentions:canvas-test').toJSON()
      ).toEqual({ [MENTION_ID]: 'artifact-1' });
    } finally {
      scene.server.free();
    }
  });

  it('refuses an item id another item already has', async () => {
    const scene = liveScene();
    try {
      await expect(
        withCanvasSession(
          scene.source,
          new AbortController().signal,
          async (session) => {
            await session.apply([
              {
                kind: 'create',
                id: ITEM_ID,
                type: 'rectangle',
                x: 0,
                y: 0,
              },
            ]);
            await embedCanvasDocument(session, EMBED);
          }
        )
      ).rejects.toThrow('already another item');
    } finally {
      scene.server.free();
    }
  });

  it('commits a document node and tracks its reference in the same flush', async () => {
    const scene = liveScene();
    try {
      const result = await withCanvasSession(
        scene.source,
        new AbortController().signal,
        (session) =>
          embedCanvasDocument(session, {
            action: 'embed',
            itemId: ITEM_ID,
            documentId: 'artifact-1',
            name: 'Onboarding',
            fileType: 'artifact',
            subpath: 'empty',
            x: 40,
            y: 60,
            width: 640,
            height: 480,
            mentionId: MENTION_ID,
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
      ).toEqual({ [MENTION_ID]: 'artifact-1' });
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
