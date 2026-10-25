import {
  createScene,
  resolveConnector,
  sortKeysBetween,
  worldMatrix,
} from '@macro-inc/graphics';
import {
  createLoroGraphicsBackend,
  createLoroSeed,
} from '@macro-inc/graphics/loro';
import {
  richTextPlainText,
  validCanvasText,
} from '@macro-inc/lexical-core/canvas-text';
import { getQuickJS } from 'quickjs-emscripten';
import { describe, expect, it } from 'vitest';
import { prepareCanvasEdit } from './operations';
import { runCanvasCode } from './sandbox';
import { canvasOpsSchema } from './schema';

describe('Canvas SDK through real QuickJS and graphics commands', () => {
  it('creates labeled shapes and bound connectors, groups without changing world pose, and orders siblings', async () => {
    const ops = runCanvasCode(
      await getQuickJS(),
      `
      const a = editor.create({type:'rectangle',x:20,y:30,width:200,height:100,text:'Start'});
      const b = editor.create({type:'ellipse',x:400,y:30,width:160,height:100,text:'Finish'});
      editor.connect({start:{point:{x:220,y:80},binding:{targetId:a,anchor:'right'}},end:{point:{x:400,y:80},binding:{targetId:b,anchor:'left'}}});
      const g = editor.group([a,b]);
      editor.move([g],0,100);
      editor.style([a],{fill:'#00ff00'});
    `
    );
    const doc = prepareCanvasEdit(createScene(), ops);
    const rect = Object.values(doc.items).find(
      (item) => item.type === 'rectangle'
    );
    const ellipse = Object.values(doc.items).find(
      (item) => item.type === 'ellipse'
    );
    const connector = Object.values(doc.items).find(
      (item) => item.type === 'connector'
    );
    expect(rect?.type).toBe('rectangle');
    expect(rect && worldMatrix(doc, rect.id).slice(4)).toEqual([20, 130]);
    if (
      rect?.type !== 'rectangle' ||
      ellipse?.type !== 'ellipse' ||
      connector?.type !== 'connector'
    )
      throw new Error('Missing scene items');
    expect(rect.appearance.fill).toBe('#00ff00');
    expect(validCanvasText(rect.geometry.label?.content)).toBe(true);
    expect(richTextPlainText(rect.geometry.label!.content)).toBe('Start');
    expect(resolveConnector(doc, connector).geometry.start.point).toEqual({
      x: 220,
      y: 180,
    });
    expect(resolveConnector(doc, connector).geometry.end.point).toEqual({
      x: 400,
      y: 180,
    });
  });

  it('rejects a malformed later operation without modifying the input scene', async () => {
    const awaitedQuickJS = await getQuickJS();
    const original = createScene();
    const ops = runCanvasCode(
      await getQuickJS(),
      `const a=editor.create({type:'rectangle',x:0,y:0,width:100,height:100}); editor.text('missing','oops');`
    );
    expect(() => prepareCanvasEdit(original, ops)).toThrow('no longer exists');
    expect(Object.keys(original.items)).toHaveLength(1);
    expect(() =>
      canvasOpsSchema.parse([
        {
          kind: 'create',
          id: 'bad',
          type: 'document',
          x: 0,
          y: 0,
          width: 10,
          height: 10,
        },
      ])
    ).toThrow();
    expect(() =>
      runCanvasCode(
        awaitedQuickJS,
        'editor.create({type:"rectangle",x:0,y:0,width:-1,height:2})'
      )
    ).toThrow();
  });

  it('bounds CPU, output and host access', async () => {
    const qjs = await getQuickJS();
    expect(() => runCanvasCode(qjs, 'while(true) {}')).toThrow();
    expect(() => runCanvasCode(qjs, 'fetch("https://example.com")')).toThrow();
    expect(() =>
      runCanvasCode(
        qjs,
        'for(let i=0;i<101;i++) editor.create({type:"text",x:0,y:0,width:10,height:10})'
      )
    ).toThrow();
    expect(() => runCanvasCode(qjs, 'editor.move(["a"],NaN,0)')).toThrow();
    expect(() =>
      runCanvasCode(
        qjs,
        'editor.ops.push({kind:"create",id:"forged",type:"rectangle",x:0,y:0,width:1,height:1})'
      )
    ).toThrow('host-generated');
  });

  it('merges independent human style and AI movement in real Loro replicas', async () => {
    const ops = runCanvasCode(
      await getQuickJS(),
      'editor.create({type:"rectangle",x:10,y:20,width:100,height:80,text:"Original"})'
    );
    const seed = createLoroSeed(prepareCanvasEdit(createScene(), ops));
    const rootId = createScene().rootId;
    const alice = createLoroGraphicsBackend(seed, '101', rootId);
    const bot = createLoroGraphicsBackend(seed, '999999999999999001', rootId);
    const first = ops[0];
    if (first?.kind !== 'create') throw new Error('Missing create');
    const id = first.id;
    try {
      const aliceUpdates: Uint8Array[] = [];
      const botUpdates: Uint8Array[] = [];
      alice.subscribeUpdates((update) => aliceUpdates.push(update));
      bot.subscribeUpdates((update) => botUpdates.push(update));
      alice.commit(
        prepareCanvasEdit(alice.getDocument(), [
          { kind: 'style', ids: [id], style: { fill: '#ff0000' } },
        ])
      );
      bot.commit(
        prepareCanvasEdit(bot.getDocument(), [
          { kind: 'move', ids: [id], dx: 50, dy: 60 },
        ])
      );
      aliceUpdates.forEach(bot.receive);
      botUpdates.forEach(alice.receive);
      expect(alice.getDocument()).toEqual(bot.getDocument());
      expect(worldMatrix(bot.getDocument(), id).slice(4)).toEqual([60, 80]);
      expect(bot.getDocument().items[id]).toMatchObject({
        appearance: { fill: '#ff0000' },
      });
      bot.undo();
      expect(bot.getDocument().items[id]).toMatchObject({
        appearance: { fill: '#ff0000' },
      });
      expect(worldMatrix(bot.getDocument(), id).slice(4)).toEqual([10, 20]);
    } finally {
      alice.dispose();
      bot.dispose();
    }
  });

  it('preserves embedded document identities and refuses deletion through groups', () => {
    const scene = createScene([
      {
        id: 'reference',
        type: 'document',
        transform: [1, 0, 0, 1, 10, 20],
        placement: {
          parentId: 'scene-root',
          sortKey: sortKeysBetween(null, null, 1)[0]!,
        },
        appearance: { fill: '#ffffff', stroke: '#000000' },
        geometry: {
          width: 340,
          height: 136,
          documentId: 'linked-document',
          name: 'Linked document',
          fileType: 'md',
          display: 'preview',
        },
      },
    ]);
    const moved = prepareCanvasEdit(scene, [
      { kind: 'move', ids: ['reference'], dx: 50, dy: 10 },
      { kind: 'resize', id: 'reference', width: 400, height: 200 },
    ]);
    expect(moved.items.reference).toMatchObject({
      geometry: {
        documentId: 'linked-document',
        display: 'preview',
        width: 400,
        height: 200,
      },
    });
    expect(worldMatrix(moved, 'reference').slice(4)).toEqual([60, 30]);
    const grouped = prepareCanvasEdit(moved, [
      { kind: 'group', id: 'group', ids: ['reference'] },
    ]);
    expect(() =>
      prepareCanvasEdit(grouped, [{ kind: 'delete', ids: ['group'] }])
    ).toThrow('reference bookkeeping');
    expect(grouped.items.reference).toMatchObject({
      geometry: { documentId: 'linked-document' },
    });
  });
});
