import { describe, expect, it } from 'vitest';
import { PeerPool } from './peer-pool';

const names = ['A', 'B', 'C'];
const colors = ['red', 'green'];

describe('PeerPool', () => {
  it('borrowing N peers yields N distinct names', async () => {
    const pool = new PeerPool({ names, colors });
    const peers = await Promise.all([pool.borrow(), pool.borrow(), pool.borrow()]);
    expect(new Set(peers.map((p) => p.name)).size).toBe(3);
    expect(peers.map((p) => p.name).sort()).toEqual(['A', 'B', 'C']);
    expect(pool.outstanding).toBe(3);
  });

  it('releasing then borrowing reuses a freed name', async () => {
    const pool = new PeerPool({ names, colors });
    const a = await pool.borrow();
    const b = await pool.borrow();
    pool.release(a);
    const c = await pool.borrow();
    expect(c.name).toBe(a.name);
    expect(c.name).not.toBe(b.name);
    expect(pool.outstanding).toBe(2);
  });

  it('grows with still-unique names when the base list is exhausted', async () => {
    const pool = new PeerPool({ names, colors, max: 5 });
    const peers = await Promise.all([pool.borrow(), pool.borrow(), pool.borrow(), pool.borrow(), pool.borrow()]);
    expect(new Set(peers.map((p) => p.name)).size).toBe(5);
    expect(pool.outstanding).toBe(5);
  });

  it('release of an unknown peer is a no-op', async () => {
    const pool = new PeerPool({ names, colors });
    const a = await pool.borrow();
    pool.release({ name: 'X', color: 'blue' }); // never borrowed
    pool.release(a);
    pool.release(a); // double release
    expect(pool.outstanding).toBe(0);
  });

  it('outstanding tracks borrows and releases', async () => {
    const pool = new PeerPool({ names, colors });
    expect(pool.outstanding).toBe(0);
    const a = await pool.borrow();
    const b = await pool.borrow();
    expect(pool.outstanding).toBe(2);
    pool.release(b);
    expect(pool.outstanding).toBe(1);
    pool.release(a);
    expect(pool.outstanding).toBe(0);
  });

  it('prefers distinct colors while the palette lasts', async () => {
    const pool = new PeerPool({ names, colors });
    const a = await pool.borrow();
    const b = await pool.borrow();
    expect(a.color).not.toBe(b.color);
  });

  it('defaults to AI_NAMES / COLORS', async () => {
    const pool = new PeerPool();
    const p = await pool.borrow();
    expect(p.name).toContain('(AI)');
    expect(p.color).toBeTruthy();
  });

  it('caps concurrent borrows at max, releasing a slot for the next waiter', async () => {
    const pool = new PeerPool({ names, colors, max: 2 });
    const a = await pool.borrow();
    const b = await pool.borrow();
    expect(pool.outstanding).toBe(2);

    // A third borrow must wait — the pool is full.
    let third: { name: string } | undefined;
    const pending = pool.borrow().then((p) => {
      third = p;
      return p;
    });
    await Promise.resolve(); // give the queue a tick; still blocked
    expect(third).toBeUndefined();
    expect(pool.outstanding).toBe(2);

    // Releasing one opens the slot; the waiter resolves and reuses the name.
    pool.release(a);
    const c = await pending;
    expect(third).toBe(c);
    expect(c.name).toBe(a.name);
    expect(pool.outstanding).toBe(2);
    void b;
  });

  it('defaults max to 3', async () => {
    const pool = new PeerPool({ names: ['A', 'B', 'C', 'D'], colors });
    const three = await Promise.all([pool.borrow(), pool.borrow(), pool.borrow()]);
    expect(pool.outstanding).toBe(3);

    const fourth = pool.borrow(); // blocks: no slot is free
    await Promise.resolve();
    expect(pool.outstanding).toBe(3); // never acquires while full

    pool.release(three[0]!);
    const p = await fourth; // slot opened → resolves
    expect(p.name).toBe(three[0]!.name);
    expect(pool.outstanding).toBe(3);
  });
});
