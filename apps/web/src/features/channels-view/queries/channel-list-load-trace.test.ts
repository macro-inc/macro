import { createRoot, createSignal } from 'solid-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const setAttr = vi.hoisted(() => vi.fn());
vi.mock('@app/observability/flow', () => ({
  useFlow: () => ({ span: { setAttr } }),
}));

import {
  type ChannelListLoad,
  traceChannelListLoad,
} from './channel-list-load-trace';

const WAITING: ChannelListLoad = {
  enabled: true,
  rows: 0,
  fetching: false,
  answered: false,
  pages: 1,
  failed: false,
};

function trace(initial: ChannelListLoad) {
  return createRoot((dispose) => {
    const [load, setLoad] = createSignal(initial);
    traceChannelListLoad('threads', load);
    return { setLoad, dispose };
  });
}

const recorded = () =>
  Object.fromEntries(setAttr.mock.calls.map(([key, value]) => [key, value]));

describe('sidebar list load trace', () => {
  beforeEach(() => {
    setAttr.mockClear();
  });

  it('records a cold load as one request with no cache hit, once', () => {
    const { setLoad, dispose } = trace(WAITING);
    setLoad({ ...WAITING, fetching: true });
    expect(setAttr).not.toHaveBeenCalled();
    setLoad({ ...WAITING, rows: 40, answered: true });

    expect(recorded()).toEqual({
      'channels.sidebar.threads.cache_hit': false,
      'channels.sidebar.threads.rows': 40,
      'channels.sidebar.threads.pages': 1,
      'channels.sidebar.threads.requests': 1,
      'channels.sidebar.threads.failed': false,
    });

    // A later refresh is not another load of the view.
    setLoad({ ...WAITING, rows: 40, answered: true, fetching: true });
    setLoad({ ...WAITING, rows: 41, answered: true });
    expect(setAttr).toHaveBeenCalledTimes(5);
    dispose();
  });

  it('records rows shown while the network is still answering as a cache hit', () => {
    const { setLoad, dispose } = trace({ ...WAITING, fetching: true });
    setLoad({ ...WAITING, rows: 12, answered: true, fetching: true });
    setLoad({ ...WAITING, rows: 14, answered: true });

    expect(recorded()).toMatchObject({
      'channels.sidebar.threads.cache_hit': true,
      'channels.sidebar.threads.rows': 14,
      'channels.sidebar.threads.requests': 1,
    });
    dispose();
  });

  it('records a lookup answered from the cache alone as no request', () => {
    const { setLoad, dispose } = trace(WAITING);
    setLoad({ ...WAITING, rows: 3, answered: true });

    expect(recorded()).toMatchObject({
      'channels.sidebar.threads.cache_hit': true,
      'channels.sidebar.threads.requests': 0,
    });
    dispose();
  });

  it('records a failed load and starts over when the list is enabled again', () => {
    const { setLoad, dispose } = trace({ ...WAITING, fetching: true });
    setLoad({ ...WAITING, answered: true, failed: true });
    expect(recorded()).toMatchObject({
      'channels.sidebar.threads.failed': true,
      'channels.sidebar.threads.requests': 1,
    });

    setAttr.mockClear();
    setLoad({ ...WAITING, enabled: false });
    setLoad({ ...WAITING, fetching: true });
    setLoad({ ...WAITING, rows: 2, answered: true });
    expect(recorded()).toMatchObject({
      'channels.sidebar.threads.failed': false,
      'channels.sidebar.threads.requests': 1,
    });
    dispose();
  });
});
