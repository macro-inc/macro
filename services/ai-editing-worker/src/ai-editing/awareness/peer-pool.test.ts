import { describe, expect, it } from 'vitest';
import { PeerPool } from './peer-pool';

const colors = ['red', 'green'];

describe('PeerPool', () => {
  it('labels every concurrent writer with the editor', async () => {
    const pool = PeerPool.forEditor('Macro', { colors });
    const peers = await Promise.all([
      pool.borrow(),
      pool.borrow(),
      pool.borrow(),
    ]);
    expect(peers.map((p) => p.name)).toEqual([
      'Macro (AI)',
      'Macro (AI)',
      'Macro (AI)',
    ]);
    expect(pool.outstanding).toBe(3);
  });

  it('labels two editors distinctly', async () => {
    const grunk = await PeerPool.forEditor('Grunk', { colors }).borrow();
    const cursor = await PeerPool.forEditor('Cursor', { colors }).borrow();
    expect(grunk.name).toBe('Grunk (AI)');
    expect(cursor.name).toBe('Cursor (AI)');
  });

  it('hands out distinct peer ids and cycles colors', async () => {
    const pool = PeerPool.forEditor('Grunk', { colors });
    const a = await pool.borrow();
    const b = await pool.borrow();
    expect(a.peerId).not.toBe(b.peerId);
    expect(a.color).not.toBe(b.color);
  });

  it('reuses a released writer', async () => {
    const pool = PeerPool.forEditor('Cursor', { colors, max: 1 });
    const a = await pool.borrow();
    pool.release(a);
    const b = await pool.borrow();
    expect(b).toBe(a);
    expect(b.name).toBe('Cursor (AI)');
  });

  it('release of an unknown peer is a no-op', async () => {
    const pool = PeerPool.forEditor('Macro', { colors });
    const a = await pool.borrow();
    pool.release({ name: 'X', color: 'blue', peerId: 0n }); // never borrowed
    pool.release(a);
    pool.release(a); // double release
    expect(pool.outstanding).toBe(0);
  });

  it('blocks borrows past max until a slot frees', async () => {
    const pool = PeerPool.forEditor('Macro', { colors, max: 2 });
    const [a] = await Promise.all([pool.borrow(), pool.borrow()]);

    let third: { name: string } | undefined;
    const pending = pool.borrow().then((p) => {
      third = p;
      return p;
    });
    await Promise.resolve();
    expect(third).toBeUndefined(); // never acquires while full
    expect(pool.outstanding).toBe(2);

    pool.release(a!);
    expect(await pending).toBe(a);
    expect(pool.outstanding).toBe(2);
  });
});
