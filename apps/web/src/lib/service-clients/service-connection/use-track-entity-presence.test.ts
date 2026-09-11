/**
 * @vitest-environment jsdom
 *
 * Connection-gateway presence: open when an entity id is known, ping while
 * focused, close on id change or unmount. Agent sessions stay silent until
 * the real session id exists (a placeholder is not an entity).
 */

import { createRoot, createSignal } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const trackEntity = vi.hoisted(() => vi.fn());

vi.mock('./client', () => ({
  connectionGatewayClient: { trackEntity },
}));
vi.mock('@core/signal/tabFocus', () => ({
  isTabFocused: () => true,
}));

const { useEntityPresenceTracking } = await import(
  './use-track-entity-presence'
);

describe('useEntityPresenceTracking', () => {
  beforeEach(() => {
    trackEntity.mockClear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not track while the id is absent', () => {
    const dispose = createRoot((dispose) => {
      useEntityPresenceTracking('agent_session', () => undefined);
      return dispose;
    });
    expect(trackEntity).not.toHaveBeenCalled();
    dispose();
    expect(trackEntity).not.toHaveBeenCalled();
  });

  it('opens when an agent session id appears and closes on unmount', () => {
    const [sessionId, setSessionId] = createSignal<string>();
    const dispose = createRoot((dispose) => {
      useEntityPresenceTracking('agent_session', sessionId);
      return dispose;
    });

    expect(trackEntity).not.toHaveBeenCalled();

    setSessionId('session-1');
    expect(trackEntity).toHaveBeenCalledTimes(1);
    expect(trackEntity).toHaveBeenCalledWith({
      entity_type: 'agent_session',
      entity_id: 'session-1',
      action: 'open',
    });

    dispose();
    expect(trackEntity).toHaveBeenLastCalledWith({
      entity_type: 'agent_session',
      entity_id: 'session-1',
      action: 'close',
    });
  });

  it('closes the previous entity before opening the next', () => {
    const [sessionId, setSessionId] = createSignal<string | undefined>(
      'session-1'
    );
    const dispose = createRoot((dispose) => {
      useEntityPresenceTracking('agent_session', sessionId);
      return dispose;
    });

    trackEntity.mockClear();
    setSessionId('session-2');
    expect(trackEntity.mock.calls).toEqual([
      [
        {
          entity_type: 'agent_session',
          entity_id: 'session-1',
          action: 'close',
        },
      ],
      [
        {
          entity_type: 'agent_session',
          entity_id: 'session-2',
          action: 'open',
        },
      ],
    ]);
    dispose();
  });

  it('pings the open entity on the channel interval', () => {
    const dispose = createRoot((dispose) => {
      useEntityPresenceTracking('channel', () => 'channel-1');
      return dispose;
    });

    trackEntity.mockClear();
    vi.advanceTimersByTime(20_000);
    expect(trackEntity).toHaveBeenCalledWith({
      entity_type: 'channel',
      entity_id: 'channel-1',
      action: 'ping',
    });
    dispose();
  });
});
