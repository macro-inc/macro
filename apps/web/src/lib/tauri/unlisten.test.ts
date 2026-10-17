// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { unlistenQuietly } from './unlisten';

let unhandled: unknown[];
const recordUnhandled = (reason: unknown) => unhandled.push(reason);

beforeEach(() => {
  unhandled = [];
  process.on('unhandledRejection', recordUnhandled);
});

afterEach(() => {
  process.off('unhandledRejection', recordUnhandled);
});

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const rejectingUnlisten = () =>
  vi.fn(() => Promise.reject('event listener not found'));

describe('unlistenQuietly', () => {
  it('absorbs a rejecting unlisten function', async () => {
    const unlisten = rejectingUnlisten();
    unlistenQuietly(unlisten);
    await settle();
    expect(unlisten).toHaveBeenCalledOnce();
    expect(unhandled).toEqual([]);
  });

  it('unlistens once a pending listen() resolves', async () => {
    const unlisten = rejectingUnlisten();
    unlistenQuietly(Promise.resolve(unlisten));
    await settle();
    expect(unlisten).toHaveBeenCalledOnce();
    expect(unhandled).toEqual([]);
  });

  it('absorbs a listen() that failed', async () => {
    unlistenQuietly(Promise.reject(new Error('listen failed')));
    await settle();
    expect(unhandled).toEqual([]);
  });

  it('accepts a listener that was never registered', async () => {
    unlistenQuietly(undefined);
    unlistenQuietly(Promise.resolve(undefined));
    await settle();
    expect(unhandled).toEqual([]);
  });
});
