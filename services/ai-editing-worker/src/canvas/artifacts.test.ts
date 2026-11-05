import { createScene, presentationOrder } from '@macro-inc/graphics';
import { getQuickJS } from 'quickjs-emscripten';
import { describe, expect, it } from 'vitest';
import { artifactLibraryEdits, prepareCanvasEdit } from './operations';
import { runCanvasCode } from './sandbox';
import { canvasOpSchema } from './schema';
import { describeCanvas, withCanvasSession } from './session';
import { liveScene } from './test-fixtures';

const created = (id: string, html = '<p>Hi</p>') =>
  ({ kind: 'createArtifact', id, x: 0, y: 0, title: id, html }) as const;

const artifactHtml = (document: ReturnType<typeof createScene>, id: string) => {
  const item = document.items[id];
  if (item?.type !== 'artifact') throw new Error('Not an artifact');
  return item.geometry.html;
};

describe('artifact operations', () => {
  it('creates artifacts that present in creation order', () => {
    const document = prepareCanvasEdit(createScene(), [
      created('a'),
      created('b'),
    ]);

    expect(presentationOrder(document).map((item) => item.id)).toEqual([
      'a',
      'b',
    ]);
  });

  it('edits one exact occurrence of the HTML', () => {
    const base = prepareCanvasEdit(createScene(), [
      created('a', '<p>One</p><p>Two</p>'),
    ]);

    const edited = prepareCanvasEdit(base, [
      { kind: 'artifactEdit', id: 'a', find: 'Two', replace: 'Three' },
    ]);
    expect(artifactHtml(edited, 'a')).toBe('<p>One</p><p>Three</p>');

    expect(() =>
      prepareCanvasEdit(base, [
        { kind: 'artifactEdit', id: 'a', find: 'Nope', replace: 'x' },
      ])
    ).toThrow('not in the HTML');
    expect(() =>
      prepareCanvasEdit(base, [
        { kind: 'artifactEdit', id: 'a', find: '<p>', replace: 'x' },
      ])
    ).toThrow('more than once');
  });

  it('rejects an edit that would pass the size limit', () => {
    const base = prepareCanvasEdit(createScene(), [
      created('a', 'x'.repeat(255_000)),
    ]);

    expect(() =>
      prepareCanvasEdit(base, [
        {
          kind: 'artifactEdit',
          id: 'a',
          find: 'xx',
          replace: 'y'.repeat(2000),
        },
      ])
    ).toThrow();
  });

  it('reorders the presentation with the listed artifacts first', () => {
    const base = prepareCanvasEdit(createScene(), [
      created('a'),
      created('b'),
      created('c'),
    ]);

    const document = prepareCanvasEdit(base, [
      { kind: 'presentOrder', ids: ['c'] },
    ]);
    expect(presentationOrder(document).map((item) => item.id)).toEqual([
      'c',
      'a',
      'b',
    ]);
  });

  it('turns definitions into library edits, leaving the scene alone', () => {
    const ops = [
      { kind: 'defineStyle', name: 'brand', css: 'h1{}' },
      { kind: 'defineComponent', name: 'card', html: null },
    ] as const;

    expect(artifactLibraryEdits([...ops])).toEqual([
      { kind: 'styles', name: 'brand', source: 'h1{}' },
      { kind: 'components', name: 'card', source: null },
    ]);
    const scene = createScene();
    expect(prepareCanvasEdit(scene, [...ops]).items).toEqual(scene.items);
  });

  it('rejects unsafe library names', () => {
    expect(
      canvasOpSchema.safeParse({
        kind: 'defineStyle',
        name: 'a"><script>',
        css: '',
      }).success
    ).toBe(false);
  });
});

describe('reading artifacts', () => {
  const document = prepareCanvasEdit(createScene(), [created('a', 'SOURCE')]);
  const library = { styles: { brand: 'CSS' }, components: {} };

  it('gives only metadata and names unless items are named', () => {
    const scene = JSON.parse(describeCanvas(document, undefined, library));

    expect(JSON.stringify(scene.items)).not.toContain('SOURCE');
    expect(scene.items[0].htmlLength).toBe(6);
    expect(scene.artifactLibrary.styles).toEqual(['brand']);
    expect(scene.artifactGuide).toContain('createArtifact');
  });

  it('gives source when items are named', () => {
    const scene = JSON.parse(describeCanvas(document, ['a'], library));

    expect(scene.items[0].geometry.html).toBe('SOURCE');
    expect(scene.artifactLibrary.styles).toEqual({ brand: 'CSS' });
  });

  it('shows no source or guide to a user without artifacts', () => {
    const text = describeCanvas(document, ['a']);

    expect(text).not.toContain('SOURCE');
    expect(text).not.toContain('artifactGuide');
    expect(text).not.toContain('artifactLibrary');
  });
});

describe('artifact rollout', () => {
  it('commits nothing for a user without artifacts', async () => {
    const scene = liveScene();

    await expect(
      withCanvasSession(scene.source, new AbortController().signal, (session) =>
        session.apply([created('a')])
      )
    ).rejects.toThrow('not available');
    expect(scene.writes()).toBe(0);
  });

  it('commits artifacts and the library in one write', async () => {
    const scene = liveScene();

    await withCanvasSession(
      scene.source,
      new AbortController().signal,
      async (session) => {
        await session.apply([
          created('a'),
          { kind: 'defineStyle', name: 'brand', css: 'h1{}' },
        ]);
        const snapshot = session.snapshot();
        expect(snapshot.artifacts).toBe(true);
        expect(snapshot.artifactLibrary?.styles).toEqual({ brand: 'h1{}' });
        expect(snapshot.document.items.a?.type).toBe('artifact');
      },
      undefined,
      true
    );
    expect(scene.writes()).toBe(1);
    expect(scene.server.getMap('artifactStyles').get('brand')).toBe('h1{}');
  });
});

describe('artifact SDK in the sandbox', () => {
  it('runs the SDK and validates what it produces', async () => {
    const ops = await runCanvasCode(
      await getQuickJS(),
      `const id = editor.createArtifact({ x: 1, y: 2, title: 'Deck', html: snippets.page });
       editor.artifactEdit(id, 'Hi', 'Hello');
       editor.defineStyle('brand', 'h1{}');
       editor.defineComponent('card', null);
       editor.presentOrder([id]);`,
      { page: '<p>Hi</p>' }
    );

    expect(ops.map((op) => op.kind)).toEqual([
      'createArtifact',
      'artifactEdit',
      'defineStyle',
      'defineComponent',
      'presentOrder',
    ]);
    const document = prepareCanvasEdit(createScene(), ops);
    const created = ops[0];
    if (created?.kind !== 'createArtifact') throw new Error('Not created');
    expect(artifactHtml(document, created.id)).toBe('<p>Hello</p>');
  });

  it('does not let code choose a new artifact id', async () => {
    const quickJS = await getQuickJS();

    expect(() =>
      runCanvasCode(
        quickJS,
        `editor.add({ kind: 'createArtifact', id: 'chosen', x: 0, y: 0, title: '', html: '' });`
      )
    ).toThrow('host-generated');
  });
});
