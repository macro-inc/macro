import { CombinedError } from '@urql/core';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  FAULT_ROW_MS,
  isDeviceFault,
  REREAD_DELAYS_MS,
  rereadAfterDeviceFault,
  resetRereads,
} from '../rereads';
import { CHANNEL_ID } from './fixtures';

const { refreshChannelViews } = vi.hoisted(() => ({
  refreshChannelViews: vi.fn(),
}));
vi.mock('../catch-up', () => ({ refreshChannelViews }));

const OTHER_CHANNEL = '00000000-0000-7000-8000-00000000c0de';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  resetRereads();
  refreshChannelViews.mockClear();
});

it('reads the channel again shortly after a device fault', () => {
  rereadAfterDeviceFault(CHANNEL_ID);

  expect(refreshChannelViews).not.toHaveBeenCalled();
  vi.advanceTimersByTime(REREAD_DELAYS_MS[0]);
  expect(refreshChannelViews).toHaveBeenCalledExactlyOnceWith(CHANNEL_ID);
});

it('reads once for faults that come while a reread waits', () => {
  rereadAfterDeviceFault(CHANNEL_ID);
  rereadAfterDeviceFault(CHANNEL_ID);
  rereadAfterDeviceFault(CHANNEL_ID);

  vi.advanceTimersByTime(REREAD_DELAYS_MS[0]);
  expect(refreshChannelViews).toHaveBeenCalledTimes(1);
});

it('reads further apart while rereads keep failing, then leaves the channel alone', () => {
  for (const delay of REREAD_DELAYS_MS) {
    rereadAfterDeviceFault(CHANNEL_ID);
    vi.advanceTimersByTime(delay - 1);
    const before = refreshChannelViews.mock.calls.length;
    vi.advanceTimersByTime(1);
    expect(refreshChannelViews).toHaveBeenCalledTimes(before + 1);
  }

  rereadAfterDeviceFault(CHANNEL_ID);
  vi.advanceTimersByTime(30_000);
  expect(refreshChannelViews).toHaveBeenCalledTimes(REREAD_DELAYS_MS.length);
});

it('starts again for a fault long after the last one', () => {
  for (const delay of REREAD_DELAYS_MS) {
    rereadAfterDeviceFault(CHANNEL_ID);
    vi.advanceTimersByTime(delay);
  }
  vi.advanceTimersByTime(FAULT_ROW_MS);

  rereadAfterDeviceFault(CHANNEL_ID);
  vi.advanceTimersByTime(REREAD_DELAYS_MS[0]);
  expect(refreshChannelViews).toHaveBeenCalledTimes(
    REREAD_DELAYS_MS.length + 1
  );
});

it('does not start again while faults keep coming, however slowly', () => {
  for (let fault = 0; fault < 10; fault += 1) {
    rereadAfterDeviceFault(CHANNEL_ID);
    vi.advanceTimersByTime(FAULT_ROW_MS - 1);
  }
  expect(refreshChannelViews).toHaveBeenCalledTimes(REREAD_DELAYS_MS.length);
});

it('drops a reread still to come when the account goes', () => {
  rereadAfterDeviceFault(CHANNEL_ID);
  resetRereads();

  vi.advanceTimersByTime(REREAD_DELAYS_MS[0]);
  expect(refreshChannelViews).not.toHaveBeenCalled();
});

it('takes a worker failure for a device fault, and a server failure for none', () => {
  expect(
    isDeviceFault(new Error('cache worker timeout: channel-timeline'))
  ).toBe(true);
  expect(
    isDeviceFault(
      new CombinedError({ graphQLErrors: [{ message: 'not found' }] })
    )
  ).toBe(false);
  expect(
    isDeviceFault(new CombinedError({ networkError: new Error('offline') }))
  ).toBe(false);
});

it('counts each channel on its own', () => {
  rereadAfterDeviceFault(CHANNEL_ID);
  rereadAfterDeviceFault(OTHER_CHANNEL);

  vi.advanceTimersByTime(REREAD_DELAYS_MS[0]);
  expect(refreshChannelViews).toHaveBeenCalledWith(CHANNEL_ID);
  expect(refreshChannelViews).toHaveBeenCalledWith(OTHER_CHANNEL);
});
