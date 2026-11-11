import { createScene, fitTextLayout } from '@macro-inc/graphics';
import { createLoroGraphicsBackendFromDoc } from '@macro-inc/graphics/loro';
import { okAsync } from 'neverthrow';
import { describe, expect, it } from 'vitest';
import { prepareCanvasEdit } from './operations';
import { describeCanvas, withCanvasSession } from './session';
import { liveScene } from './test-fixtures';

describe('live Canvas editing sessions', () => {
  it('animates independent batches concurrently without invalidating either commit', async () => {
    const scene = liveScene();
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    let waiting = 0;
    const active = new Set<string>();
    try {
      await withCanvasSession(
        scene.source,
        new AbortController().signal,
        async (session) => {
          const apply = (id: string, x: number) =>
            session.apply(
              [
                {
                  kind: 'create',
                  id,
                  type: 'rectangle',
                  x,
                  y: 0,
                  width: 100,
                  height: 80,
                },
              ],
              {
                animate: true,
                present: (value) => {
                  if (value?.preview) active.add(id);
                  else active.delete(id);
                },
                sleep: async () => {
                  if (waiting < 2) {
                    waiting++;
                    if (waiting === 2) entered.resolve();
                    await release.promise;
                  }
                },
              }
            );
          const edits = Promise.all([apply('left', 0), apply('right', 400)]);
          await entered.promise;
          expect([...active].sort()).toEqual(['left', 'right']);
          expect(scene.writes()).toBe(0);
          release.resolve();
          expect(
            (await edits).map((result) => result.operationsApplied)
          ).toEqual([1, 1]);
          expect(active.size).toBe(0);
        }
      );
      expect(scene.writes()).toBe(2);
    } finally {
      scene.server.free();
    }
  });

  it('cancels an uncommitted animation and clears its transient presence', async () => {
    const scene = liveScene();
    const controller = new AbortController();
    const presentations: unknown[] = [];
    try {
      await expect(
        withCanvasSession(scene.source, controller.signal, async (session) =>
          session.apply(
            [
              {
                kind: 'create',
                id: 'cancelled',
                type: 'rectangle',
                x: 0,
                y: 0,
                width: 100,
                height: 80,
              },
            ],
            {
              animate: true,
              present: (value) => {
                presentations.push(value);
              },
              sleep: async () => {
                controller.abort();
              },
            }
          )
        )
      ).rejects.toThrow();
      expect(scene.writes()).toBe(0);
      expect(presentations.at(-1)).toBeUndefined();
      expect(scene.closed()).toBe(true);
    } finally {
      scene.server.free();
    }
  });

  it('rejects a batch if a human changes its target during animation', async () => {
    const scene = liveScene();
    const human = createLoroGraphicsBackendFromDoc(scene.server, 'scene-root');
    human.commit(
      prepareCanvasEdit(human.getDocument(), [
        {
          kind: 'create',
          id: 'box',
          type: 'rectangle',
          x: 0,
          y: 0,
          width: 100,
          height: 80,
        },
      ])
    );
    let interfered = false;
    try {
      await expect(
        withCanvasSession(
          scene.source,
          new AbortController().signal,
          async (session) =>
            session.apply([{ kind: 'text', id: 'box', text: 'AI' }], {
              animate: true,
              sleep: async () => {
                if (interfered) return;
                interfered = true;
                const update = Promise.withResolvers<Uint8Array>();
                const unsubscribe = human.subscribeUpdates(update.resolve);
                human.commit(
                  prepareCanvasEdit(human.getDocument(), [
                    { kind: 'text', id: 'box', text: 'Human wins' },
                  ])
                );
                scene.send({ type: 'update', update: await update.promise });
                unsubscribe();
              },
            })
        )
      ).rejects.toThrow('nothing from this batch was committed');
      expect(scene.writes()).toBe(0);
      expect(describeCanvas(human.getDocument())).toContain('Human wins');
    } finally {
      human.dispose();
      scene.server.free();
    }
  });

  it('refreshes accepted server changes before commit when live delivery is delayed', async () => {
    const scene = liveScene();
    const human = createLoroGraphicsBackendFromDoc(scene.server, 'scene-root');
    human.commit(
      prepareCanvasEdit(human.getDocument(), [
        {
          kind: 'create',
          id: 'box',
          type: 'rectangle',
          x: 0,
          y: 0,
          width: 120,
          height: 80,
        },
      ])
    );
    let changed = false;
    try {
      await expect(
        withCanvasSession(
          scene.source,
          new AbortController().signal,
          async (session) =>
            session.apply([{ kind: 'move', ids: ['box'], dx: 400, dy: 0 }], {
              animate: true,
              sleep: async () => {
                if (changed) return;
                changed = true;
                // Server has accepted this change, but the AI socket has not received it.
                human.commit(
                  prepareCanvasEdit(human.getDocument(), [
                    { kind: 'text', id: 'box', text: 'Human wins' },
                  ])
                );
              },
            })
        )
      ).rejects.toThrow('nothing from this batch was committed');
      expect(scene.writes()).toBe(0);
      expect(describeCanvas(human.getDocument())).toContain('Human wins');
    } finally {
      human.dispose();
      scene.server.free();
    }
  });

  it.each(['text', 'mentionUser'] as const)(
    'rejects stale %s measurements after a concurrent human relabel',
    async (kind) => {
      const scene = liveScene();
      const human = createLoroGraphicsBackendFromDoc(
        scene.server,
        'scene-root'
      );
      human.commit(
        prepareCanvasEdit(human.getDocument(), [
          {
            kind: 'create',
            id: 'box',
            type: 'rectangle',
            x: 0,
            y: 0,
            width: 120,
            height: 80,
            text: 'Before',
          },
        ])
      );
      try {
        await expect(
          withCanvasSession(
            scene.source,
            new AbortController().signal,
            async (session) =>
              session.apply(
                [
                  kind === 'text'
                    ? {
                        kind,
                        id: 'box',
                        text: 'AI replacement that needs measurement',
                      }
                    : {
                        kind,
                        id: 'box',
                        at: 0,
                        person: {
                          userId: 'macro|alice@example.com',
                          email: 'alice@example.com',
                        },
                      },
                ],
                {
                  measure: async (snapshot) => {
                    const update = Promise.withResolvers<Uint8Array>();
                    const unsubscribe = human.subscribeUpdates(update.resolve);
                    human.commit(
                      prepareCanvasEdit(human.getDocument(), [
                        {
                          kind: 'text',
                          id: 'box',
                          text: 'Human wins during measurement',
                        },
                      ])
                    );
                    scene.send({
                      type: 'update',
                      update: await update.promise,
                    });
                    unsubscribe();
                    return { document: snapshot.document, effects: [] };
                  },
                }
              )
          )
        ).rejects.toThrow('nothing from this batch was committed');
        expect(scene.writes()).toBe(0);
        expect(describeCanvas(human.getDocument())).toContain(
          'Human wins during measurement'
        );
      } finally {
        human.dispose();
        scene.server.free();
      }
    }
  );

  it('retains an explicit fixed-text policy through CRDT reload and a later relabel', async () => {
    const scene = liveScene();
    const owner = createLoroGraphicsBackendFromDoc(scene.server, 'scene-root');
    const initial = prepareCanvasEdit(owner.getDocument(), [
      {
        kind: 'create',
        id: 'fixed',
        type: 'rectangle',
        x: 0,
        y: 0,
        width: 120,
        height: 80,
        text: 'Fits',
      },
    ]);
    owner.commit(
      fitTextLayout(initial, [{ id: 'fixed', mode: 'error' }], () => ({
        width: 80,
        height: 24,
      })).document
    );
    try {
      await expect(
        withCanvasSession(
          scene.source,
          new AbortController().signal,
          async (session) =>
            session.apply(
              [{ kind: 'text', id: 'fixed', text: 'Longer replacement' }],
              {
                measure: async (snapshot, requests) =>
                  fitTextLayout(snapshot.document, requests, () => ({
                    width: 96,
                    height: 400,
                  })),
              }
            )
        )
      ).rejects.toThrow('fixed interior');
      expect(scene.writes()).toBe(0);
      const restored = JSON.parse(
        describeCanvas(owner.getDocument(), ['fixed'])
      ).items[0];
      expect(restored.text).toBe('Fits');
      expect(restored.geometry.label.fitText).toBe('error');
      expect(restored.bounds).toMatchObject({ width: 120, height: 80 });
    } finally {
      owner.dispose();
      scene.server.free();
    }
  });

  it('marks shortened labels explicitly even when the item count fits', () => {
    const scene = prepareCanvasEdit(createScene(), [
      {
        kind: 'create',
        id: 'long-label',
        type: 'rectangle',
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        text: 'a'.repeat(2001),
      },
    ]);
    const result = JSON.parse(describeCanvas(scene));
    expect(result).toMatchObject({ totalItems: 1, truncated: true });
    expect(result.items[0]).toMatchObject({
      text: 'a'.repeat(2000),
      textTruncated: true,
      pointsTruncated: false,
    });
  });

  it('reads without writes and always closes the source', async () => {
    const scene = liveScene();
    try {
      const read = await withCanvasSession(
        scene.source,
        new AbortController().signal,
        async (session) => session.read()
      );
      expect(JSON.parse(read)).toMatchObject({
        totalItems: 0,
        truncated: false,
      });
      expect(scene.writes()).toBe(0);
      expect(scene.closed()).toBe(true);
    } finally {
      scene.server.free();
    }
  });

  it('keeps remote human items arriving between model reads and applies', async () => {
    const scene = liveScene();
    try {
      await withCanvasSession(
        scene.source,
        new AbortController().signal,
        async (session) => {
          session.read();
          const human = createLoroGraphicsBackendFromDoc(
            scene.server,
            'scene-root'
          );
          const update = Promise.withResolvers<Uint8Array>();
          human.subscribeUpdates(update.resolve);
          human.commit(
            prepareCanvasEdit(human.getDocument(), [
              {
                kind: 'create',
                id: 'human',
                type: 'ellipse',
                x: 20,
                y: 20,
                width: 50,
                height: 50,
              },
            ])
          );
          const bytes = await update.promise;
          // Engine imports immediately through its real remote-update entry point.
          scene.send({ type: 'update', update: bytes });
          const result = await session.apply([
            {
              kind: 'create',
              id: 'bot',
              type: 'rectangle',
              x: 100,
              y: 20,
              width: 50,
              height: 50,
            },
          ]);
          expect(result.operationsApplied).toBe(1);
          human.dispose();
        }
      );
      const result = createLoroGraphicsBackendFromDoc(
        scene.server,
        'scene-root'
      );
      expect(Object.keys(result.getDocument().items).sort()).toEqual([
        'bot',
        'human',
        'scene-root',
      ]);
      result.dispose();
      expect(scene.closed()).toBe(true);
    } finally {
      scene.server.free();
    }
  });

  it('waits for the actual server acknowledgement before reporting success', async () => {
    const scene = liveScene();
    const sent = Promise.withResolvers<void>();
    const ack = Promise.withResolvers<boolean>();
    scene.source.pushUpdate = async (updates) => {
      updates.forEach((update) => scene.server.import(update));
      sent.resolve();
      return ack.promise;
    };
    let finished = false;
    try {
      const work = withCanvasSession(
        scene.source,
        new AbortController().signal,
        async (session) =>
          session.apply([
            {
              kind: 'create',
              id: 'bot',
              type: 'rectangle',
              x: 0,
              y: 0,
              width: 50,
              height: 50,
            },
          ])
      ).then((result) => {
        finished = true;
        return result;
      });
      await sent.promise;
      expect(finished).toBe(false);
      ack.resolve(true);
      expect((await work).operationsApplied).toBe(1);
      expect(scene.closed()).toBe(true);
    } finally {
      scene.server.free();
    }
  });

  it('reports an uncertain write if the server received it but the acknowledgement was lost', async () => {
    const scene = liveScene();
    scene.source.pushUpdate = async (updates) => {
      updates.forEach((update) => scene.server.import(update));
      return false;
    };
    try {
      await expect(
        withCanvasSession(
          scene.source,
          new AbortController().signal,
          async (session) =>
            session.apply([
              {
                kind: 'create',
                id: 'bot',
                type: 'rectangle',
                x: 0,
                y: 0,
                width: 50,
                height: 50,
              },
            ])
        )
      ).rejects.toThrow('may have applied');
      expect(scene.closed()).toBe(true);
    } finally {
      scene.server.free();
    }
  });

  it('cancels before mutation and cleans up invalid initial snapshots', async () => {
    const scene = liveScene();
    const controller = new AbortController();
    try {
      await expect(
        withCanvasSession(scene.source, controller.signal, async (session) => {
          controller.abort();
          return session.apply([
            {
              kind: 'create',
              id: 'bot',
              type: 'rectangle',
              x: 0,
              y: 0,
              width: 50,
              height: 50,
            },
          ]);
        })
      ).rejects.toThrow();
      expect(scene.writes()).toBe(0);
      expect(scene.closed()).toBe(true);
      scene.source.doInitialSync = () =>
        okAsync({
          snapshot: new Uint8Array([1, 2, 3]),
          awareness: new Uint8Array(),
        });
      await expect(
        withCanvasSession(
          scene.source,
          new AbortController().signal,
          async (session) => session.read()
        )
      ).rejects.toThrow('Invalid canvas snapshot');
    } finally {
      scene.server.free();
    }
  });
});
