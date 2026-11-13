import { Mirror, schema } from '@loro-mirror/core';
import { LoroDoc } from 'loro-crdt';
import { describe, expect, it, vi } from 'vitest';
import {
  createGraphicsEditor,
  createGraphicsEditorFromBackend,
  createScene,
  resolveSlideTransition,
  type SlideTransition,
  setAllTransitionsCommand,
  setArtifactCommand,
  translation,
  validSlideTransition,
} from '../src/core';
import {
  createLoroGraphicsBackend,
  createLoroGraphicsBackendFromDoc,
  createLoroSeed,
} from '../src/loro';
import { canvasNodeSchema } from '../src/loro/schema';

const artifact = (
  id: string,
  sortKey: string,
  transition?: SlideTransition
) => ({
  id,
  type: 'artifact' as const,
  placement: { parentId: 'scene-root', sortKey },
  transform: translation(0, 0),
  appearance: { fill: 'transparent', stroke: 'transparent' },
  geometry: {
    width: 640,
    height: 360,
    title: id,
    html: '<h1>Slide</h1>',
    designWidth: 1280,
    designHeight: 720,
    presentOrder: sortKey,
    ...(transition ? { transition } : {}),
  },
});

function sceneNode(doc: LoroDoc, id: string) {
  const node = doc
    .getTree('scene')
    .getNodes()
    .find((node) => node.data.get('id') === id);
  if (!node) throw new Error(`Missing node ${id}`);
  return node;
}

describe('validSlideTransition', () => {
  it('accepts known kinds with optional fields in range', () => {
    expect(validSlideTransition({ kind: 'none' })).toBe(true);
    expect(
      validSlideTransition({
        kind: 'push',
        durationMs: 100,
        easing: 'easeOut',
        direction: 'up',
      })
    ).toBe(true);
    expect(validSlideTransition({ kind: 'fly', durationMs: 5000 })).toBe(true);
  });

  it('rejects unknown kinds, out-of-range durations and unknown options', () => {
    expect(validSlideTransition(null)).toBe(false);
    expect(validSlideTransition('fade')).toBe(false);
    expect(validSlideTransition({ kind: 'spin' })).toBe(false);
    expect(validSlideTransition({ kind: 'fade', durationMs: 99 })).toBe(false);
    expect(validSlideTransition({ kind: 'fade', durationMs: 5001 })).toBe(
      false
    );
    expect(validSlideTransition({ kind: 'fade', durationMs: Number.NaN })).toBe(
      false
    );
    expect(validSlideTransition({ kind: 'fade', easing: 'bounce' })).toBe(
      false
    );
    expect(validSlideTransition({ kind: 'push', direction: 'in' })).toBe(false);
  });
});

describe('resolveSlideTransition', () => {
  it('prefers the slide, then the deck default, then a cut', () => {
    expect(resolveSlideTransition({ kind: 'fade' }, { kind: 'push' })).toEqual({
      kind: 'fade',
      durationMs: 400,
      easing: 'easeInOut',
      direction: 'left',
    });
    expect(
      resolveSlideTransition(undefined, { kind: 'fly', direction: 'up' })
    ).toEqual({
      kind: 'fly',
      durationMs: 1200,
      easing: 'easeInOut',
      direction: 'up',
    });
    expect(resolveSlideTransition()).toMatchObject({ kind: 'none' });
  });

  it('does not merge fields from the deck default into the slide', () => {
    expect(
      resolveSlideTransition(
        { kind: 'pan' },
        { kind: 'pan', durationMs: 3000, easing: 'linear' }
      )
    ).toMatchObject({ durationMs: 900, easing: 'easeInOut' });
  });
});

describe('artifact transition commands', () => {
  it('sets, validates and clears a slide transition', () => {
    const editor = createGraphicsEditor(createScene([artifact('a', 'a0')]));
    editor.execute(setArtifactCommand, {
      id: 'a',
      content: { transition: { kind: 'cube', direction: 'right' } },
    });
    expect(editor.document.items.a).toMatchObject({
      geometry: { transition: { kind: 'cube', direction: 'right' } },
    });

    expect(() =>
      editor.execute(setArtifactCommand, {
        id: 'a',
        content: { transition: { kind: 'fade', durationMs: 10 } },
      })
    ).toThrow('Invalid artifact geometry');

    editor.execute(setArtifactCommand, {
      id: 'a',
      content: { transition: null },
    });
    const item = editor.document.items.a;
    expect(item?.type === 'artifact' && 'transition' in item.geometry).toBe(
      false
    );
    editor.dispose();
  });

  it('applies one transition to every slide as one undo step', () => {
    const editor = createGraphicsEditor(
      createScene([artifact('a', 'a0', { kind: 'fade' }), artifact('b', 'a1')])
    );
    editor.execute(setAllTransitionsCommand, {
      transition: { kind: 'path' },
    });
    for (const id of ['a', 'b'])
      expect(editor.document.items[id]).toMatchObject({
        geometry: { transition: { kind: 'path' } },
      });

    editor.undo();
    expect(editor.document.items.a).toMatchObject({
      geometry: { transition: { kind: 'fade' } },
    });
    expect(editor.document.items.b).not.toHaveProperty('geometry.transition');

    editor.execute(setAllTransitionsCommand, { transition: null });
    expect(editor.document.items.a).not.toHaveProperty('geometry.transition');
    editor.dispose();
  });
});

describe('Loro transition register', () => {
  it('round-trips a slide transition and clearing it', () => {
    const backend = createLoroGraphicsBackend(
      createLoroSeed(
        createScene([artifact('a', 'a0', { kind: 'push', direction: 'up' })])
      ),
      '1',
      'scene-root'
    );
    expect(backend.getDocument().items.a).toMatchObject({
      geometry: { transition: { kind: 'push', direction: 'up' } },
    });

    const editor = createGraphicsEditorFromBackend(backend);
    editor.execute(setArtifactCommand, {
      id: 'a',
      content: { transition: null },
    });
    expect(backend.getDocument().items.a).not.toHaveProperty(
      'geometry.transition'
    );
    editor.dispose();
    backend.dispose();
  });

  it('ignores an invalid stored value and keeps it when the node is rewritten', () => {
    const doc = new LoroDoc();
    doc.import(createLoroSeed(createScene([artifact('a', 'a0')])));
    doc.setPeerId('2');
    sceneNode(doc, 'a').data.set('transition', { kind: 'warp' });
    doc.commit();

    const backend = createLoroGraphicsBackendFromDoc(doc, 'scene-root');
    expect(backend.getDocument().items.a).not.toHaveProperty(
      'geometry.transition'
    );

    const editor = createGraphicsEditorFromBackend(backend);
    editor.execute(setArtifactCommand, {
      id: 'a',
      content: { html: '<h1>Edited</h1>' },
    });
    expect(sceneNode(doc, 'a').data.get('html')).toBe('<h1>Edited</h1>');
    expect(sceneNode(doc, 'a').data.get('transition')).toEqual({
      kind: 'warp',
    });
    editor.dispose();
    backend.dispose();
    doc.free();
  });

  it('survives a rewrite by a client that predates the register', () => {
    const doc = new LoroDoc();
    doc.import(
      createLoroSeed(createScene([artifact('a', 'a0', { kind: 'fade' })]))
    );
    doc.setPeerId('3');

    // An older client's schema has no transition field. Its writer copies the
    // stored node data and changes only what its edit touched.
    const { transition: _transition, ...oldFields } =
      canvasNodeSchema.definition;
    const oldSchema = schema(
      {
        scene: schema.LoroTree(schema.LoroMap(oldFields), (data) => data.id),
      },
      { allowUnknown: true }
    );
    const mirror = new Mirror({ doc, schema: oldSchema });
    const [node] = mirror.getState().scene;
    if (!node) throw new Error('Missing node');
    mirror.setState({
      scene: [
        {
          ...node,
          data: {
            ...node.data,
            html: '<h1>Old client</h1>',
            pose: { ...node.data.pose, transform: translation(50, 0) },
          },
        },
      ],
    });
    doc.commit();
    mirror.dispose();

    expect(sceneNode(doc, 'a').data.get('html')).toBe('<h1>Old client</h1>');
    const backend = createLoroGraphicsBackendFromDoc(doc, 'scene-root');
    expect(backend.getDocument().items.a).toMatchObject({
      geometry: { transition: { kind: 'fade' } },
    });
    backend.dispose();
    doc.free();
  });
});

describe('deck default transition', () => {
  it('syncs between peers, lands with a scene commit and ignores invalid values', async () => {
    const seed = createLoroSeed(createScene([artifact('a', 'a0')]));
    const left = createLoroGraphicsBackend(seed, '1', 'scene-root');
    const right = createLoroGraphicsBackend(seed, '2', 'scene-root');
    const updates: Uint8Array[] = [];
    left.subscribeUpdates((bytes) => updates.push(bytes));
    const notified = vi.fn();
    right.presentation.subscribe(notified);
    expect(right.presentation.read()).toEqual({});

    left.presentation.edit({ transition: { kind: 'overview' } });
    right.receive(updates[0]!);
    await Promise.resolve();
    expect(notified).toHaveBeenCalled();
    expect(right.presentation.read()).toEqual({
      transition: { kind: 'overview' },
    });

    const document = left.getDocument();
    const slide = document.items.a;
    if (slide?.type !== 'artifact') throw new Error('Missing slide');
    left.commit(
      {
        ...document,
        items: {
          ...document.items,
          a: { ...slide, geometry: { ...slide.geometry, title: 'Renamed' } },
        },
      },
      [],
      { transition: null }
    );
    expect(updates).toHaveLength(2);
    right.receive(updates[1]!);
    expect(right.presentation.read()).toEqual({});
    expect(right.getDocument().items.a).toMatchObject({
      geometry: { title: 'Renamed' },
    });

    expect(() =>
      left.presentation.edit({
        transition: { kind: 'fade', durationMs: 1 },
      })
    ).toThrow('Invalid slide transition');

    left.dispose();
    right.dispose();
  });

  it('reads an invalid stored deck default as absent', () => {
    const doc = new LoroDoc();
    doc.import(createLoroSeed(createScene([artifact('a', 'a0')])));
    doc.getMap('presentation').set('transition', { kind: 'warp' });
    doc.commit();
    const backend = createLoroGraphicsBackendFromDoc(doc, 'scene-root');
    expect(backend.presentation.read()).toEqual({});
    backend.dispose();
    doc.free();
  });
});
