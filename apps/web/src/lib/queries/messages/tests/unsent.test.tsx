import { render } from '@solidjs/testing-library';
import { createStore } from 'solid-js/store';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UNSENT_AFTER_MS, useMessageUnsent } from '../unsent';

const { channelCacheHost, sending } = vi.hoisted(() => ({
  channelCacheHost: vi.fn((): object | undefined => ({})),
  sending: vi.fn((_messageId: string) => false),
}));
vi.mock('../local/channel-flag', () => ({ channelCacheHost }));
vi.mock('../local/channel-sync', () => ({
  channelWrites: () => ({ sending }),
}));

function Probe(props: { id: string }) {
  const unsent = useMessageUnsent(() => props.id);
  return <output>{unsent() ? 'unsent' : 'ok'}</output>;
}

describe('useMessageUnsent', () => {
  const [sends, setSends] = createStore<Record<string, boolean>>({});
  beforeEach(() => {
    vi.useFakeTimers();
    setSends({ m1: false, m2: false });
    sending.mockImplementation((id) => sends[id] ?? false);
  });
  afterEach(() => {
    vi.useRealTimers();
    channelCacheHost.mockReturnValue({});
  });

  it('marks only a send that has stayed pending, until it settles', async () => {
    const mine = render(() => <Probe id="m1" />);
    const other = render(() => <Probe id="m2" />);

    setSends('m1', true);
    await vi.advanceTimersByTimeAsync(UNSENT_AFTER_MS - 1);
    expect(mine.container.textContent).toBe('ok');
    await vi.advanceTimersByTimeAsync(1);
    expect(mine.container.textContent).toBe('unsent');
    expect(other.container.textContent).toBe('ok');

    setSends('m1', false);
    expect(mine.container.textContent).toBe('ok');
  });

  it('follows no send while channels send over REST', async () => {
    channelCacheHost.mockReturnValue(undefined);
    sending.mockClear();
    const view = render(() => <Probe id="m1" />);

    setSends('m1', true);
    await vi.advanceTimersByTimeAsync(UNSENT_AFTER_MS + 1);

    expect(view.container.textContent).toBe('ok');
    expect(sending).not.toHaveBeenCalled();
  });
});
