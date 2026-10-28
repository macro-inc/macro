import type { HistorySession } from '@service-sync/client';
import {
  type Frontiers,
  LoroDoc,
  LoroMap,
  LoroMovableList,
  LoroText,
} from 'loro-crdt';
import { describe, expect, it } from 'vitest';
import { sessionize } from './sessionize';
import { buildTimestampIndex } from './timestampIndex';

// The markdown editor's Loro layout: lexical's serialized state, with each
// text node's text in a LoroText and children in movable lists.
function paragraph(id: string, text: string) {
  const node = new LoroMap();
  node.setContainer('$', new LoroMap()).set('id', id);
  node.set('type', 'paragraph');
  node.set('direction', 'ltr');
  node.set('format', '');
  node.set('indent', 0);
  node.set('version', 1);
  node.set('textFormat', 0);
  node.set('textStyle', '');
  const textNode = node
    .setContainer('children', new LoroMovableList())
    .insertContainer(0, new LoroMap());
  textNode.setContainer('$', new LoroMap()).set('id', `${id}-text`);
  textNode.set('type', 'text');
  textNode.set('detail', 0);
  textNode.set('format', 0);
  textNode.set('mode', 'normal');
  textNode.set('style', '');
  textNode.set('version', 1);
  textNode.setContainer('text', new LoroText()).insert(0, text);
  return node;
}

function createRoot(doc: LoroDoc, paragraphs: string[]) {
  const root = doc.getMap('root');
  root.set('type', 'root');
  root.set('direction', 'ltr');
  root.set('format', '');
  root.set('indent', 0);
  root.set('version', 1);
  const children = root.setContainer('children', new LoroMovableList());
  paragraphs.forEach((text, i) => {
    children.pushContainer(paragraph(`p${i}`, text));
  });
}

function blocks(doc: LoroDoc) {
  const children = doc.getMap('root').get('children');
  if (!(children instanceof LoroMovableList)) throw new Error('no children');
  return children;
}

function textOf(block: unknown): LoroText {
  if (!(block instanceof LoroMap)) throw new Error('not a block');
  const textNode = block.get('children').get(0);
  return textNode.get('text');
}

function commitAt(doc: LoroDoc, seconds: number) {
  doc.setNextCommitTimestamp(seconds);
  doc.commit();
}

function sync(target: LoroDoc, ...sources: LoroDoc[]) {
  for (const source of sources) {
    target.import(
      source.export({ mode: 'update', from: target.oplogVersion() })
    );
  }
}

function sessionsOf(doc: LoroDoc): HistorySession[] {
  const events: { userId: string; tMs: number }[] = [];
  for (const [peer, changes] of doc.getAllChanges()) {
    for (const change of changes) {
      events.push({ userId: peer, tMs: change.timestamp * 1000 });
    }
  }
  return sessionize(events);
}

// Three authors taking turns: each session edits 40 times, mostly typing into a
// random paragraph and sometimes adding one, an hour after the last session.
function buildLargeDoc(sessionCount: number) {
  const authors = [1n, 2n, 3n].map((peer) => {
    const doc = new LoroDoc();
    doc.setPeerId(peer);
    return doc;
  });
  createRoot(
    authors[0],
    Array.from({ length: 40 }, (_, i) => `Paragraph ${i}`)
  );
  commitAt(authors[0], 1_700_000_000);
  let seconds = 1_700_000_100;
  let seed = 1;
  const random = (n: number) => {
    seed = (seed * 1_103_515_245 + 12_345) % 2 ** 31;
    return seed % n;
  };
  for (let s = 0; s < sessionCount; s++) {
    const author = authors[s % authors.length];
    sync(author, ...authors.filter((other) => other !== author));
    const list = blocks(author);
    for (let edit = 0; edit < 40; edit++) {
      if (random(10) === 0) {
        list.insertContainer(
          random(list.length + 1),
          paragraph(`s${s}-${edit}`, 'A new paragraph')
        );
      } else {
        const text = textOf(list.get(random(list.length)));
        text.insert(random(text.length + 1), 'word ');
      }
      commitAt(author, seconds);
      seconds += 20;
    }
    seconds += 3600;
  }
  const doc = new LoroDoc();
  sync(doc, ...authors);
  return doc;
}

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
