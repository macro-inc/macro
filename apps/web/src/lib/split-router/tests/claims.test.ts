import { describe, expect, it } from 'vitest';
import { createClaimReservations } from '../claims';

const one = { namespace: 'document', id: 'one' };
const two = { namespace: 'document', id: 'two' };

describe('pending claim reservations', () => {
  it('grants contenders turns in reservation order', async () => {
    const claims = createClaimReservations();
    const first = claims.reserve(one);
    const second = claims.reserve(one);
    const third = claims.reserve(one);
    const signal = new AbortController().signal;
    expect(first.wait(signal)).toBeUndefined();
    const secondTurn = second.wait(signal);
    let thirdReady = false;
    const thirdTurn = (async () => {
      await third.wait(signal);
      thirdReady = true;
    })();
    first.release();
    await secondTurn;
    expect(thirdReady).toBe(false);
    second.release();
    await thirdTurn;
    expect(thirdReady).toBe(true);
    third.release();
  });

  it('moves redirected reservations without blocking the original claim', async () => {
    const claims = createClaimReservations();
    const first = claims.reserve(one);
    const second = claims.reserve(one);
    const other = claims.reserve(two);
    const signal = new AbortController().signal;
    const secondTurn = second.wait(signal);
    first.move(two);
    await secondTurn;
    let firstReady = false;
    const firstTurn = (async () => {
      await first.wait(signal);
      firstReady = true;
    })();
    await Promise.resolve();
    expect(firstReady).toBe(false);
    other.release();
    await firstTurn;
    first.release();
    second.release();
  });

  it('does not let an obsolete release remove a newer reservation', () => {
    const claims = createClaimReservations();
    const stale = claims.reserve(one);
    stale.release();
    const owner = claims.reserve(one);
    const waiter = claims.reserve(one);
    stale.release();
    stale.move(one);
    expect(owner.wait(new AbortController().signal)).toBeUndefined();
    const controller = new AbortController();
    const waiting = waiter.wait(controller.signal);
    expect(waiting).toBeInstanceOf(Promise);
    controller.abort();
    owner.release();
    waiter.release();
    return expect(waiting).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('removes aborted wait listeners and distinguishes namespaces and IDs', async () => {
    const claims = createClaimReservations();
    const owner = claims.reserve(one);
    const waiter = claims.reserve(one);
    const controller = new AbortController();
    const waiting = waiter.wait(controller.signal);
    controller.abort();
    await expect(waiting).rejects.toMatchObject({ name: 'AbortError' });
    waiter.release();
    owner.release();
    const other = claims.reserve({ namespace: 'folder', id: one.id });
    const document = claims.reserve(one);
    expect(other.wait(new AbortController().signal)).toBeUndefined();
    expect(document.wait(new AbortController().signal)).toBeUndefined();
    other.release();
    document.release();
  });

  it('keeps reservation state local to each router owner', () => {
    const first = createClaimReservations().reserve(one);
    const second = createClaimReservations().reserve(one);
    expect(first.wait(new AbortController().signal)).toBeUndefined();
    expect(second.wait(new AbortController().signal)).toBeUndefined();
    first.release();
    second.release();
  });
});
