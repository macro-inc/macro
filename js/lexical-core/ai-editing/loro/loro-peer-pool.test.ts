import { describe, expect, it } from 'vitest';
import { LoroDoc } from 'loro-crdt';
import { LoroPeerPool } from './loro-peer-pool';

describe('LoroPeerPool', () => {
  it('borrowing N yields N distinct ids', async () => {
    const ids = [10n, 11n, 12n, 13n];
    const pool = new LoroPeerPool(ids);
    const borrowed = await Promise.all(ids.map(() => pool.borrow()));
    expect(new Set(borrowed).size).toBe(ids.length);
    expect([...borrowed].sort()).toEqual([...ids].sort());
    expect(pool.available).toBe(0);
  });

  it('the (N+1)th borrow awaits until a release', async () => {
    const pool = new LoroPeerPool([1n, 2n]);
    const a = await pool.borrow();
    const b = await pool.borrow();
    expect(pool.available).toBe(0);

    let resolved = false;
    const pending = pool.borrow().then((id) => {
      resolved = true;
      return id;
    });
    // Nothing free, so the third borrow must not have resolved yet.
    await Promise.resolve();
    expect(resolved).toBe(false);

    pool.release(a);
    const handedOut = await pending;
    expect(resolved).toBe(true);
    // The released id is handed straight to the waiter, not parked as free.
    expect(handedOut).toBe(a);
    expect(pool.available).toBe(0);

    pool.release(b);
    pool.release(handedOut);
    expect(pool.available).toBe(2);
  });

  it('release returns an id to the pool for reuse', async () => {
    const pool = new LoroPeerPool([7n]);
    const first = await pool.borrow();
    expect(pool.available).toBe(0);
    pool.release(first);
    expect(pool.available).toBe(1);
    const second = await pool.borrow();
    expect(second).toBe(first);
  });

  it('round-robins across all ids for serial borrow/release', async () => {
    const pool = new LoroPeerPool([1n, 2n, 3n]);
    const seen: bigint[] = [];
    for (let i = 0; i < 6; i++) {
      const id = await pool.borrow();
      seen.push(id);
      pool.release(id);
    }
    // Serial edits cycle through every id rather than reusing one.
    expect(seen).toEqual([1n, 2n, 3n, 1n, 2n, 3n]);
  });

  it('is deterministic with an explicit id list', () => {
    const pool = new LoroPeerPool([100n, 200n, 300n]);
    expect(pool.peerIds()).toEqual([100n, 200n, 300n]);
    expect(pool.size).toBe(3);
  });

  it('fromSeed mints distinct ids offset from a base', () => {
    const pool = LoroPeerPool.fromSeed(1000n, 4);
    expect(pool.peerIds()).toEqual([1001n, 1002n, 1003n, 1004n]);
  });

  it('rejects an empty or duplicated id list', () => {
    expect(() => new LoroPeerPool([])).toThrow();
    expect(() => new LoroPeerPool([5n, 5n])).toThrow();
  });

  it('with() releases even when the body throws', async () => {
    const pool = new LoroPeerPool([1n]);
    await expect(pool.with(() => { throw new Error('boom'); })).rejects.toThrow('boom');
    expect(pool.available).toBe(1);
  });
});

describe('per-edit loro peer attribution via the pool', () => {
  // Mirrors the worker's propagate path: before each commit it rotates the doc's
  // peer id through the pool, so the doc's history shows several distinct authors.
  it('attributes successive commits to multiple distinct loro peers', () => {
    const doc = new LoroDoc();
    doc.setPeerId(1n); // the doc's own (un-pooled) peer id
    const text = doc.getText('body');
    const pool = LoroPeerPool.fromSeed(doc.peerId, 4);

    const localUpdates: Uint8Array[] = [];
    doc.subscribeLocalUpdates((u) => localUpdates.push(u));

    // Apply more edits than the pool size to exercise rotation/cycling. This is
    // exactly the worker's `propagate`: rotate → commit (flush) → setPeerId →
    // mutate+commit.
    for (let i = 0; i < 10; i++) {
      const peer = pool.rotate()!;
      doc.commit();
      doc.setPeerId(peer);
      text.insert(text.length, String(i));
      doc.commit();
    }

    const peersInHistory = [...doc.getAllChanges().keys()];
    // Every commit fired a local update for the WS push (regardless of peer).
    expect(localUpdates.length).toBeGreaterThanOrEqual(10);
    // Exactly the pool's distinct authors — all 4 pooled peers were used.
    const pooled = new Set(pool.peerIds().map((p) => p.toString()));
    const used = peersInHistory.filter((p) => pooled.has(p));
    expect(new Set(used).size).toBe(pool.size);
    // Bounded by the pool size (the doc's own peer authored nothing here).
    expect(peersInHistory.length).toBeLessThanOrEqual(pool.size + 1);
  });

  it('an idle pool (all ids reserved via async borrow) rotates to undefined', async () => {
    const pool = new LoroPeerPool([1n, 2n]);
    await pool.borrow();
    await pool.borrow();
    // Both reserved by long-lived async borrowers; rotate must not steal them.
    expect(pool.rotate()).toBeUndefined();
  });
});
