// @vitest-environment node

import { readDocxState } from '@macro-inc/collaboration/docx/schema';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { bridge, fixture, loadEngine, TestPeer } from '../tests/docx-test-peer';

beforeAll(loadEngine, 60_000);

const peers: TestPeer[] = [];
afterEach(() => {
  for (const peer of peers.splice(0)) peer.close();
});

/** A seeding peer plus `count - 1` peers joined from its snapshot. */
function room(count: number, name = 'mutual-nda.docx'): TestPeer[] {
  const bytes = fixture(name);
  const first = new TestPeer(bytes);
  const seed = first.doc.export({ mode: 'snapshot' });
  const all = [first];
  for (let i = 1; i < count; i++) all.push(new TestPeer(bytes, seed));
  peers.push(...all);
  return all;
}

function exchange(all: TestPeer[]) {
  for (let round = 0; round < 2; round++)
    for (const peer of all)
      peer.deliver(...all.filter((other) => other !== peer));
}

function expectConverged(all: TestPeer[]) {
  const [first, ...rest] = all;
  const shared = readDocxState(first.doc);
  for (const peer of rest) {
    expect(peer.text()).toEqual(first.text());
    expect(readDocxState(peer.doc).order).toEqual(shared.order);
  }
  // The engine sessions agree with the shared document they converged on.
  for (const peer of all)
    expect(peer.sync.sharedState.order).toEqual(shared.order);
}

function anchor(peer: TestPeer, index: number) {
  return peer.bodyIds()[index];
}

function edit(peer: TestPeer, index: number, text: string) {
  const result = JSON.parse(
    bridge().ReplaceTextAtSpan(peer.handle, anchor(peer, index), 0, 0, text)
  );
  expect(result.success).toBe(true);
  peer.sync.publishLocal();
}

describe('DocxSyncController', () => {
  it('opens joining peers on the seeded document', () => {
    const [alice, bob] = room(2);
    expect(bob.bodyIds()).toEqual(alice.bodyIds());
    expect(bob.text()).toEqual(alice.text());
  });

  it('propagates a text edit by patching only that block', () => {
    const [alice, bob] = room(2);
    edit(alice, 1, 'AMENDED: ');
    alice.deliver(bob);
    expect(bob.text()[1].startsWith('AMENDED: ')).toBe(true);
    expect(bob.rebuilds).toBe(0);
    expectConverged([alice, bob]);
  });

  it('merges concurrent edits to different paragraphs', () => {
    const [alice, bob, carol] = room(3);
    edit(alice, 1, '[alice] ');
    edit(bob, 3, '[bob] ');
    edit(carol, 4, '[carol] ');
    exchange([alice, bob, carol]);
    expectConverged([alice, bob, carol]);
    const text = alice.text();
    expect(text[1].startsWith('[alice] ')).toBe(true);
    expect(text[3].startsWith('[bob] ')).toBe(true);
    expect(text[4].startsWith('[carol] ')).toBe(true);
  });

  it('converges when two peers edit the same paragraph at once', () => {
    const [alice, bob] = room(2);
    edit(alice, 1, '[alice] ');
    edit(bob, 1, '[bob] ');
    exchange([alice, bob]);
    expectConverged([alice, bob]);
    expect(
      ['[alice] ', '[bob] '].some((p) => alice.text()[1].startsWith(p))
    ).toBe(true);
  });

  it('propagates paragraph splits, merges, deletes and moves', () => {
    const [alice, bob] = room(2);
    const engine = bridge();
    expect(
      JSON.parse(engine.SplitParagraph(alice.handle, anchor(alice, 1), 20))
        .success
    ).toBe(true);
    alice.sync.publishLocal();
    alice.deliver(bob);
    expectConverged([alice, bob]);
    expect(bob.bodyIds()).toEqual(alice.bodyIds());

    expect(
      JSON.parse(
        engine.MergeParagraphs(alice.handle, anchor(alice, 1), anchor(alice, 2))
      ).success
    ).toBe(true);
    alice.sync.publishLocal();
    alice.deliver(bob);
    expectConverged([alice, bob]);

    expect(
      JSON.parse(engine.DeleteBlock(bob.handle, anchor(bob, 3))).success
    ).toBe(true);
    bob.sync.publishLocal();
    bob.deliver(alice);
    expectConverged([alice, bob]);

    expect(
      JSON.parse(
        engine.MoveBlock(
          alice.handle,
          anchor(alice, 5),
          anchor(alice, 1),
          'before'
        )
      ).success
    ).toBe(true);
    alice.sync.publishLocal();
    alice.deliver(bob);
    expectConverged([alice, bob]);
    expect(alice.rebuilds + bob.rebuilds).toBe(0);
  });

  it('keeps concurrent inserts from both peers', () => {
    const [alice, bob] = room(2);
    const engine = bridge();
    engine.SplitParagraph(alice.handle, anchor(alice, 1), 10);
    alice.sync.publishLocal();
    engine.SplitParagraph(bob.handle, anchor(bob, 1), 30);
    bob.sync.publishLocal();
    const before = alice.bodyIds().length;
    exchange([alice, bob]);
    expectConverged([alice, bob]);
    expect(alice.bodyIds().length).toBe(before + 1);
  });

  it('replicates undo as an ordinary change', () => {
    const [alice, bob] = room(2);
    const original = alice.text()[1];
    edit(alice, 1, 'Typo ');
    alice.deliver(bob);
    expect(bridge().Undo(alice.handle)).toBe(true);
    alice.sync.publishLocal();
    alice.deliver(bob);
    expect(bob.text()[1]).toBe(original);
    expectConverged([alice, bob]);
  });

  it('rebuilds peers when an edit changes a package part', () => {
    const [alice, bob] = room(2);
    const result = JSON.parse(
      bridge().ApplyListFormat(alice.handle, anchor(alice, 1), 'bullet')
    );
    expect(result.success).toBe(true);
    alice.sync.publishLocal();
    alice.deliver(bob);
    expectConverged([alice, bob]);
    expect(bob.rebuilds).toBe(1);
  });

  it('opens a late joiner on the merged document', () => {
    const [alice, bob] = room(2);
    edit(alice, 1, '[alice] ');
    edit(bob, 4, '[bob] ');
    exchange([alice, bob]);
    const late = new TestPeer(
      fixture('mutual-nda.docx'),
      alice.doc.export({ mode: 'snapshot' })
    );
    peers.push(late);
    expectConverged([alice, bob, late]);
  });

  it('defers a remote change to a block the user is still typing in', () => {
    const [alice, bob] = room(2);
    const busy = anchor(bob, 1).split(':')[2];
    const host = (
      bob.sync as unknown as { host: { isBusy?: (id: string) => boolean } }
    ).host;
    host.isBusy = (id) => id === busy;
    edit(alice, 1, '[alice] ');
    alice.deliver(bob);
    expect(bob.text()[1].startsWith('[alice] ')).toBe(false);
    // Once the typing commits, this peer's version wins and both converge.
    host.isBusy = () => false;
    edit(bob, 1, '[bob] ');
    bob.deliver(alice);
    expectConverged([alice, bob]);
    expect(alice.text()[1].startsWith('[bob] ')).toBe(true);
  });

  it('handles documents with tables, content controls and headers', () => {
    const [alice, bob] = room(2, 'complex-msa.docx');
    const ids = alice.bodyIds();
    const table = ids.findIndex((id) => id.startsWith('tbl:'));
    expect(table).toBeGreaterThan(0);
    edit(alice, 2, 'Edited: ');
    expect(
      JSON.parse(
        bridge().InsertTableRow(alice.handle, cellAnchor(alice), 'below')
      ).success
    ).toBe(true);
    alice.sync.publishLocal();
    alice.deliver(bob);
    expectConverged([alice, bob]);
  });
});

describe('randomized collaboration', () => {
  it.each([11, 29, 47])(
    'converges after random concurrent edits (seed %i)',
    (seed) => {
      let state = seed;
      const random = () => {
        state = (state * 16807) % 2147483647;
        return state / 2147483647;
      };
      const pick = <T>(items: readonly T[]) =>
        items[Math.floor(random() * items.length)];
      const all = room(3);
      const engine = bridge();
      for (let step = 0; step < 40; step++) {
        const peer = pick(all);
        const paragraphs = peer
          .bodyIds()
          .filter((id) => id.startsWith('p:') || id.startsWith('h:'));
        const target = pick(paragraphs);
        const length = peer.blockText(target).length;
        const operation = Math.floor(random() * 5);
        if (operation === 0 || operation === 1) {
          engine.ReplaceTextAtSpan(
            peer.handle,
            target,
            Math.floor(random() * (length + 1)),
            0,
            `<${step}>`
          );
        } else if (operation === 2 && length > 2) {
          engine.SplitParagraph(
            peer.handle,
            target,
            1 + Math.floor(random() * (length - 1))
          );
        } else if (operation === 3 && paragraphs.length > 6) {
          engine.DeleteBlock(peer.handle, target);
        } else if (operation === 4) {
          const other = pick(paragraphs);
          if (other !== target)
            engine.MoveBlock(
              peer.handle,
              target,
              other,
              pick(['before', 'after'])
            );
        }
        peer.sync.publishLocal();
        if (random() < 0.4) peer.deliver(...all.filter((p) => p !== peer));
      }
      exchange(all);
      expectConverged(all);
    },
    60_000
  );
});

function cellAnchor(peer: TestPeer): string {
  const anchors = JSON.parse(bridge().ListAnchors!(peer.handle))
    .anchorIndex as Record<string, unknown>;
  const cell = Object.keys(anchors).find((id) => id.startsWith('tc:'));
  if (!cell) throw new Error('fixture has no table cell');
  return cell;
}
