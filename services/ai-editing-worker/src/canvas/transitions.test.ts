import { createScene } from '@macro-inc/graphics';
import { getQuickJS } from 'quickjs-emscripten';
import { describe, expect, it } from 'vitest';
import { prepareCanvasEdit, presentationEdit } from './operations';
import { canvasOverview } from './overview';
import { runCanvasCode } from './sandbox';
import { canvasOpSchema } from './schema';
import { describeCanvas, withCanvasSession } from './session';
import { liveScene } from './test-fixtures';

const slideTransition = (
  document: ReturnType<typeof createScene>,
  id: string
) => {
  const item = document.items[id];
  if (item?.type !== 'artifact') throw new Error('Not an artifact');
  return item.geometry.transition;
};

describe('transition operations', () => {
  it('creates a slide with a transition, changes it and clears it', () => {
    const created = prepareCanvasEdit(createScene(), [
      {
        kind: 'createArtifact',
        id: 'a',
        x: 0,
        y: 0,
        title: 'Intro',
        html: '<p>Hi</p>',
        transition: { kind: 'fly', durationMs: 1500 },
      },
    ]);
    expect(slideTransition(created, 'a')).toEqual({
      kind: 'fly',
      durationMs: 1500,
    });

    const changed = prepareCanvasEdit(created, [
      {
        kind: 'artifactSource',
        id: 'a',
        transition: { kind: 'push', direction: 'up' },
      },
    ]);
    expect(slideTransition(changed, 'a')).toEqual({
      kind: 'push',
      direction: 'up',
    });

    const cleared = prepareCanvasEdit(changed, [
      { kind: 'artifactSource', id: 'a', transition: null },
    ]);
    expect(slideTransition(cleared, 'a')).toBeUndefined();
  });

  it('takes the last deck default in a batch and leaves the scene alone', () => {
    const ops = [
      {
        kind: 'presentationTransition',
        transition: { kind: 'fade' },
      },
      { kind: 'presentationTransition', transition: null },
    ] as const;
    const document = createScene();

    expect(presentationEdit([...ops])).toEqual({ transition: null });
    expect(presentationEdit([])).toBeUndefined();
    expect(prepareCanvasEdit(document, [...ops])).toEqual(document);
  });

  it('rejects unknown kinds, options and out-of-range durations', () => {
    const invalid = [
      { kind: 'spin' },
      { kind: 'fade', durationMs: 50 },
      { kind: 'fade', durationMs: 6000 },
      { kind: 'fade', easing: 'bounce' },
      { kind: 'push', direction: 'in' },
      { kind: 'fade', speed: 2 },
    ];
    for (const transition of invalid) {
      expect(
        canvasOpSchema.safeParse({ kind: 'presentationTransition', transition })
          .success
      ).toBe(false);
      expect(
        canvasOpSchema.safeParse({
          kind: 'artifactSource',
          id: 'a',
          transition,
        }).success
      ).toBe(false);
    }
    expect(
      canvasOpSchema.safeParse({
        kind: 'createArtifact',
        id: 'a',
        x: 0,
        y: 0,
        title: '',
        html: '',
        transition: null,
      }).success
    ).toBe(false);
  });
});

describe('reading transitions', () => {
  const document = prepareCanvasEdit(createScene(), [
    {
      kind: 'createArtifact',
      id: 'a',
      x: 0,
      y: 0,
      title: 'Intro',
      html: '',
      transition: { kind: 'cube' },
    },
  ]);
  const library = { styles: {}, components: {} };

  it('shows each slide transition and the deck default', () => {
    const scene = JSON.parse(
      describeCanvas(document, undefined, library, {
        transition: { kind: 'pan' },
      })
    );
    expect(scene.items[0].geometry.transition).toEqual({ kind: 'cube' });
    expect(scene.deckTransition).toEqual({ kind: 'pan' });

    const overview = canvasOverview(document, undefined, {});
    expect(overview.graph).toContain('transition={"kind":"cube"}');
    expect(overview.deckTransition).toBeNull();
  });

  it('shows no deck default to a user without artifacts', () => {
    expect(describeCanvas(document)).not.toContain('deckTransition');
    expect(canvasOverview(document)).not.toHaveProperty('deckTransition');
  });
});

describe('transitions in a live session', () => {
  it('commits slides and the deck default in one write', async () => {
    const scene = liveScene();

    await withCanvasSession(
      scene.source,
      new AbortController().signal,
      async (session) => {
        await session.apply([
          {
            kind: 'createArtifact',
            id: 'a',
            x: 0,
            y: 0,
            title: 'Intro',
            html: '',
            transition: { kind: 'path' },
          },
          {
            kind: 'presentationTransition',
            transition: { kind: 'fade', durationMs: 300 },
          },
        ]);
        expect(session.snapshot().presentation).toEqual({
          transition: { kind: 'fade', durationMs: 300 },
        });
        expect(JSON.parse(session.read()).deckTransition).toEqual({
          kind: 'fade',
          durationMs: 300,
        });
      },
      undefined,
      true
    );
    expect(scene.writes()).toBe(1);
    expect(scene.server.getMap('presentation').get('transition')).toEqual({
      kind: 'fade',
      durationMs: 300,
    });
  });

  it('refuses the deck default for a user without artifacts', async () => {
    const scene = liveScene();

    await expect(
      withCanvasSession(scene.source, new AbortController().signal, (session) =>
        session.apply([
          { kind: 'presentationTransition', transition: { kind: 'fade' } },
        ])
      )
    ).rejects.toThrow('not available');
    expect(scene.writes()).toBe(0);
  });
});

describe('transition SDK in the sandbox', () => {
  it('builds transition operations that validate', async () => {
    const ops = await runCanvasCode(
      await getQuickJS(),
      `const id = editor.createArtifact({ x: 0, y: 0, title: 'Deck', html: '', transition: { kind: 'overview' } });
       editor.artifactSource(id, { transition: { kind: 'wipe', direction: 'down', easing: 'easeOut' } });
       editor.presentationTransition({ kind: 'dissolve' });
       editor.presentationTransition(null);`
    );

    expect(ops.map((op) => op.kind)).toEqual([
      'createArtifact',
      'artifactSource',
      'presentationTransition',
      'presentationTransition',
    ]);
    const created = ops[0];
    if (created?.kind !== 'createArtifact') throw new Error('Not created');
    const document = prepareCanvasEdit(createScene(), ops);
    expect(slideTransition(document, created.id)).toEqual({
      kind: 'wipe',
      direction: 'down',
      easing: 'easeOut',
    });
    expect(presentationEdit(ops)).toEqual({ transition: null });
  });

  it('rejects an invalid transition from code', async () => {
    const quickJS = await getQuickJS();

    expect(() =>
      runCanvasCode(
        quickJS,
        `editor.presentationTransition({ kind: 'teleport' });`
      )
    ).toThrow();
  });
});
