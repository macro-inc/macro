import type { ChannelEntity } from '@entity/types/entity';
import type { WithNotification } from '@entity/types/notification';
import { type Accessor, createRoot, createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createChannelDetailSource } from './channel-detail-source';

const full: WithNotification<ChannelEntity> = {
  id: 'one',
  type: 'channel',
  name: 'One',
  ownerId: 'viewer',
  channelType: 'private',
  notifications: () => [],
};
const disposers: (() => void)[] = [];
afterEach(() => disposers.splice(0).forEach((dispose) => dispose()));

function setup(
  cachedChannel: ChannelEntity | undefined = {
    ...full,
    unreadNotifications: [],
  }
) {
  return createRoot((dispose) => {
    disposers.push(dispose);
    const [id, setId] = createSignal('one');
    const [cached, setCached] = createSignal<ChannelEntity | undefined>(
      cachedChannel
    );
    const [pending, setPending] = createSignal(false);
    const [fetching, setFetching] = createSignal(false);
    const [error, setError] = createSignal<Error | null>(null);
    const [entities, setEntities] = createSignal<ChannelEntity[]>([full]);
    const readData = vi.fn(() => {
      if (pending()) throw new Error('Read a pending resource');
      return { entities: entities() };
    });
    let enabled!: Accessor<boolean>;
    const refresh = vi.fn(async () => {});
    const source = createChannelDetailSource({
      channelId: id,
      cached,
      createQuery: (_id, isEnabled) => {
        enabled = isEnabled;
        return {
          get isEnabled() {
            return enabled();
          },
          get isPending() {
            return pending();
          },
          isLoading: false,
          get isFetching() {
            return fetching();
          },
          get error() {
            return error();
          },
          get data() {
            return readData();
          },
          refresh,
        };
      },
    });
    return {
      source,
      enabled,
      setId,
      setCached,
      setPending,
      setFetching,
      setError,
      setEntities,
      readData,
      refresh,
    };
  });
}

describe('channel detail source', () => {
  it('reuses full cached notifications without touching the query data', () => {
    const { source, enabled, readData } = setup(full);
    expect(enabled()).toBe(false);
    expect(source.load()).toEqual({ status: 'ready', channel: full });
    expect(readData).not.toHaveBeenCalled();
  });

  it('refreshes an empty summary and keeps the decision stable as the list updates', () => {
    const { source, enabled, setCached, setFetching } = setup();
    expect(enabled()).toBe(true);
    setFetching(true);
    setCached(full);
    expect(enabled()).toBe(true);
    expect(source.load()).toEqual({ status: 'pending' });
    setFetching(false);
    expect(source.load()).toEqual({ status: 'ready', channel: full });
  });

  it('never reads a paused pending resource or a background refresh', () => {
    const { source, setPending, setFetching, readData } = setup();
    setPending(true);
    expect(source.load()).toEqual({ status: 'pending' });
    setPending(false);
    setFetching(true);
    expect(source.load()).toEqual({ status: 'pending' });
    expect(readData).not.toHaveBeenCalled();
  });

  it('exposes failures and missing results without accepting another channel’s data', () => {
    const { source, setError, setEntities, readData } = setup();
    const error = new Error('Failed');
    setError(error);
    expect(source.load()).toEqual({ status: 'error', error });
    expect(readData).not.toHaveBeenCalled();
    setError(null);
    setEntities([{ ...full, id: 'two' }]);
    expect(source.load()).toEqual({ status: 'ready', channel: undefined });
  });

  it('fetches an uncached route and delegates retry to the query', async () => {
    const { source, setCached, enabled, refresh } = setup();
    setCached(undefined);
    expect(enabled()).toBe(true);
    await source.refresh();
    expect(refresh).toHaveBeenCalledOnce();
  });
});
