import { type Frontiers, LoroDoc, LoroMap } from 'loro-crdt';
import { describe, expect, it } from 'vitest';
import {
  blocks,
  buildLargeDoc,
  commitAt,
  createRoot,
  paragraph,
  sessionsOf,
  sync,
  textOf,
} from './testing/history-doc';
import { buildTimestampIndex } from './timestampIndex';

function checkoutState(doc: LoroDoc, targetMs: number) {
  const frontiers: Frontiers = [];
  for (const changes of doc.getAllChanges().values()) {
    for (const change of changes) {
      if (change.timestamp * 1000 > targetMs) continue;
      frontiers.push({
        peer: change.peer,
        counter: change.counter + change.length - 1,
      });
    }
  }
  doc.checkout(doc.vvToFrontiers(doc.frontiersToVV(frontiers)));
  const state = doc.toJSON();
  doc.checkoutToLatest();
  return state;
}

describe('buildTimestampIndex', () => {
  it('reads the same states as checking the history doc out, in any order', () => {
    const alice = new LoroDoc();
    alice.setPeerId(1n);
    createRoot(alice, ['One', 'Two']);
    commitAt(alice, 1000);
    const bob = new LoroDoc();
    bob.setPeerId(2n);
    sync(bob, alice);
    textOf(blocks(bob).get(0)).insert(3, ' and a half');
    commitAt(bob, 2000);
    sync(alice, bob);
    blocks(alice).insertContainer(2, paragraph('p2', 'Three'));
    commitAt(alice, 3000);
    sync(bob, alice);
    blocks(bob).delete(1, 1);
    commitAt(bob, 4000);
    const doc = new LoroDoc();
    sync(doc, alice, bob);

    const index = buildTimestampIndex(doc);

    expect(index.checkoutAt(999_000)).toBeNull();
    for (const targetMs of [4_000_000, 1_500_000, 3_000_000, 2_000_000]) {
      expect(index.checkoutAt(targetMs)).toEqual(checkoutState(doc, targetMs));
    }
    expect(
      index
        .checkoutAt(2_500_000)
        ?.root.children.map((block) =>
          'children' in block ? block.children : null
        )
    ).toEqual([
      [expect.objectContaining({ text: 'One and a half' })],
      [expect.objectContaining({ text: 'Two' })],
    ]);
  });

  it('finds the sessions that leave the markdown unchanged', async () => {
    const alice = new LoroDoc();
    alice.setPeerId(1n);
    createRoot(alice, ['Hello']);
    commitAt(alice, 1000);

    // Bob types a word and deletes it again.
    const bob = new LoroDoc();
    bob.setPeerId(2n);
    sync(bob, alice);
    textOf(blocks(bob).get(0)).insert(5, ' world');
    commitAt(bob, 5000);
    textOf(blocks(bob).get(0)).delete(5, 6);
    commitAt(bob, 5010);

    // Carol changes an attribute markdown doesn't render.
    const carol = new LoroDoc();
    carol.setPeerId(3n);
    sync(carol, bob);
    const block = blocks(carol).get(0);
    if (!(block instanceof LoroMap)) throw new Error('not a block');
    block.set('direction', 'rtl');
    commitAt(carol, 9000);

    sync(alice, carol);
    textOf(blocks(alice).get(0)).insert(5, '!');
    commitAt(alice, 13_000);

    const doc = new LoroDoc();
    sync(doc, alice, bob, carol);
    const sessions = sessionsOf(doc);
    const unchanged = await buildTimestampIndex(doc).findUnchangedSessions(
      sessions,
      () => false
    );

    expect(
      sessions.map((session) => ({
        userId: session.userId,
        startMs: session.startMs,
        unchanged: unchanged?.has(session),
      }))
    ).toEqual([
      { userId: '1', startMs: 13_000_000, unchanged: false },
      { userId: '3', startMs: 9_000_000, unchanged: true },
      { userId: '2', startMs: 5_000_000, unchanged: true },
      { userId: '1', startMs: 1_000_000, unchanged: false },
    ]);
  });

  // Budgets are about 4x what a laptop takes, to absorb slower CI machines.
  // Checking out one of these versions from the latest one took ~3-5 s each.
  it('opens and scrubs a long history within budget', async () => {
    const doc = buildLargeDoc(300);
    const sessions = sessionsOf(doc);
    expect(sessions.length).toBeGreaterThan(300);

    const openStart = performance.now();
    const index = buildTimestampIndex(doc);
    const unchanged = await index.findUnchangedSessions(sessions, () => false);
    const openMs = performance.now() - openStart;
    expect(unchanged?.size).toBe(0);
    expect(openMs).toBeLessThan(5000);

    // Clicking sessions in list order jumps backward through history.
    let slowestJumpMs = 0;
    for (const session of sessions.slice(0, 20)) {
      const start = performance.now();
      expect(index.checkoutAt(session.endMs)).not.toBeNull();
      slowestJumpMs = Math.max(slowestJumpMs, performance.now() - start);
    }
    expect(slowestJumpMs).toBeLessThan(1000);

    // Dragging the scrubber forward moves a few changes at a time.
    const scrubStart = performance.now();
    const forward = [...sessions].sort((a, b) => a.endMs - b.endMs);
    for (const session of forward.slice(100, 200)) {
      index.checkoutAt(session.endMs);
    }
    expect((performance.now() - scrubStart) / 100).toBeLessThan(60);

    // Returning to a version already shown reuses its state.
    const revisitStart = performance.now();
    expect(index.checkoutAt(forward[150].endMs)).toBe(
      index.checkoutAt(forward[150].endMs)
    );
    expect(performance.now() - revisitStart).toBeLessThan(5);
  }, 60_000);
});
