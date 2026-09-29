import { ThrownResultError } from '@core/util/result';
import type { ChannelEntity } from '@entity/types/entity';
import { batch, createRoot, createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  ChannelDetailLoad,
  ChannelSelection,
} from '../context/channel-detail-source';
import { createChannelDetail } from './create-channel-detail';

const channel = (id: string): ChannelEntity => ({
  type: 'channel',
  id,
  name: id,
  ownerId: 'viewer',
  channelType: 'private',
});
const disposers: (() => void)[] = [];
afterEach(() => disposers.splice(0).forEach((dispose) => dispose()));

function setup() {
  return createRoot((dispose) => {
    disposers.push(dispose);
    const [selection, setSelection] = createSignal<ChannelSelection>({
      id: 'one',
    });
    const [cached, setCached] = createSignal<ChannelEntity | undefined>(
      channel('one')
    );
    const [load, setLoad] = createSignal<ChannelDetailLoad>({
      status: 'pending',
    });
    const markRead = vi.fn();
    const detail = createChannelDetail({
      selection,
      cached,
      source: { load, refresh: vi.fn(async () => {}) },
      markRead,
    });
    return {
      detail,
      setSelection,
      setCached,
      setLoad,
      markRead,
    };
  });
}

describe('channel opening', () => {
  it('changes same-channel destinations without marking the channel read again', () => {
    const { detail, setSelection, setLoad, markRead } = setup();
    setLoad({ status: 'ready', channel: channel('one') });
    expect(markRead).toHaveBeenCalledOnce();

    for (const target of [
      { messageId: 'explicit' },
      { messageId: 'explicit', threadId: 'thread' },
      { messageId: 'another', threadId: 'thread' },
    ]) {
      setSelection({ id: 'one', target });
      expect(detail.target()).toEqual({ kind: 'message', ...target });
      expect(markRead).toHaveBeenCalledOnce();
    }
    setSelection({ id: 'one' });
    expect(markRead).toHaveBeenCalledOnce();

    batch(() => {
      setSelection({ id: 'two' });
      setLoad({ status: 'ready', channel: channel('two') });
    });
    expect(markRead).toHaveBeenCalledTimes(2);
    batch(() => {
      setSelection({ id: 'one' });
      setLoad({ status: 'ready', channel: channel('one') });
    });
    expect(markRead).toHaveBeenCalledTimes(3);
  });

  it('keeps latest navigation when an equivalent selection object replaces it', () => {
    const { detail, setSelection, setLoad } = setup();
    setSelection({ id: 'one' });
    setLoad({ status: 'ready', channel: channel('one') });
    expect(detail.target()).toEqual({ kind: 'latest' });
  });

  it('opens cached metadata at latest before notifications and marks read once', () => {
    const { detail, setLoad, markRead } = setup();
    expect(detail.view()).toEqual({ status: 'ready', channel: channel('one') });
    expect(detail.target()).toEqual({ kind: 'latest' });
    expect(markRead).not.toHaveBeenCalled();
    setLoad({ status: 'ready', channel: channel('one') });
    expect(detail.target()).toEqual({ kind: 'latest' });
    expect(markRead).toHaveBeenCalledOnce();
    setLoad({ status: 'pending' });
    expect(detail.view().status).toBe('ready');
    setLoad({
      status: 'ready',
      channel: { ...channel('one'), notifications: () => [] },
    });
    expect(detail.target()).toEqual({ kind: 'latest' });
    expect(markRead).toHaveBeenCalledOnce();
  });

  it('uses explicit targets immediately, including a new target during refresh', () => {
    const { detail, setSelection, setLoad } = setup();
    setSelection({ id: 'one', target: { messageId: 'explicit' } });
    expect(detail.target()).toEqual({ kind: 'message', messageId: 'explicit' });
    setLoad({ status: 'ready', channel: channel('one') });
    setLoad({ status: 'pending' });
    setSelection({ id: 'one', target: { messageId: 'another' } });
    expect(detail.target()).toEqual({ kind: 'message', messageId: 'another' });
  });

  it('stays at latest when notification hydration completes', () => {
    const { detail, setLoad, markRead } = setup();
    setLoad({ status: 'ready', channel: channel('one') });
    expect(detail.target()).toEqual({ kind: 'latest' });
    expect(markRead).toHaveBeenCalledOnce();
  });

  it('keeps a transient fallback mounted through retry and does not jump on recovery', () => {
    const { detail, setLoad, markRead } = setup();
    setLoad({ status: 'error', error: new Error('Offline') });
    expect(detail.view().status).toBe('ready');
    expect(markRead).not.toHaveBeenCalled();
    setLoad({ status: 'pending' });
    expect(detail.view().status).toBe('ready');
    setLoad({ status: 'ready', channel: channel('one') });
    expect(detail.target()).toEqual({ kind: 'latest' });
    expect(markRead).toHaveBeenCalledOnce();
  });

  it('keeps denied content hidden through retry until a successful response', () => {
    const { detail, setLoad, markRead } = setup();
    setLoad({
      status: 'error',
      error: new ThrownResultError([
        { code: 'FORBIDDEN', message: 'Forbidden' },
      ]),
    });
    expect(detail.view().status).toBe('unavailable');
    setLoad({ status: 'pending' });
    expect(detail.view().status).toBe('unavailable');
    expect(markRead).not.toHaveBeenCalled();
    setLoad({ status: 'ready', channel: channel('one') });
    expect(detail.view().status).toBe('ready');
    expect(detail.target()).toEqual({ kind: 'latest' });
    expect(markRead).toHaveBeenCalledOnce();
  });

  it('handles missing channels and failures without cached metadata', () => {
    const { detail, setLoad, setCached, markRead } = setup();
    setCached(undefined);
    // Already visible metadata is retained while loading.
    expect(detail.view().status).toBe('ready');
    setLoad({ status: 'ready', channel: undefined });
    expect(detail.view().status).toBe('unavailable');
    setLoad({ status: 'pending' });
    expect(detail.view().status).toBe('loading');
    setLoad({ status: 'error', error: new Error('Offline') });
    expect(detail.view().status).toBe('unavailable');
    expect(markRead).not.toHaveBeenCalled();
  });

  it('ignores another channel’s result and resets navigation and marking on each open', () => {
    const { detail, setSelection, setCached, setLoad, markRead } = setup();
    batch(() => {
      setSelection({ id: 'two' });
      setCached(channel('two'));
    });
    setLoad({ status: 'ready', channel: channel('one') });
    expect(detail.target()).toEqual({ kind: 'latest' });
    expect(markRead).not.toHaveBeenCalled();
    setLoad({ status: 'ready', channel: channel('two') });
    expect(detail.target()).toEqual({ kind: 'latest' });
    expect(markRead).toHaveBeenCalledExactlyOnceWith(channel('two'));
    batch(() => {
      setSelection({ id: 'one' });
      setCached(channel('one'));
      setLoad({ status: 'pending' });
    });
    expect(detail.target()).toEqual({ kind: 'latest' });
    setLoad({ status: 'ready', channel: channel('one') });
    expect(detail.target()).toEqual({ kind: 'latest' });
    expect(markRead).toHaveBeenCalledTimes(2);
  });

  it('does not mark non-participant channels read', () => {
    const { setLoad, markRead } = setup();
    setLoad({
      status: 'ready',
      channel: { ...channel('one'), isParticipant: false },
    });
    expect(markRead).not.toHaveBeenCalled();
  });
});
