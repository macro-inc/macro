import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  parseServerMessage,
  reportVisibility,
  VISIBILITY_HEARTBEAT_MS,
} from './control';

describe('parseServerMessage', () => {
  it('keeps a state whose driver has no profile name, and one bad field does not drop the frame', () => {
    expect(
      parseServerMessage(
        JSON.stringify({
          type: 'state',
          driver: { name: null, isYou: true },
          agentHeld: true,
          waking: false,
          transport: 'vnc',
          viewers: 2,
        })
      )
    ).toEqual({
      type: 'state',
      driver: { name: null, isYou: true },
      agentHeld: true,
      waking: false,
      transport: 'vnc',
      viewers: 2,
    });

    // A field the viewer can do without arrives wrong: it falls back, the
    // driver still comes through.
    expect(
      parseServerMessage(
        JSON.stringify({
          type: 'state',
          driver: { name: 42, isYou: true },
          agentHeld: 'yes',
          transport: 'vnc',
          viewers: null,
        })
      )
    ).toEqual({
      type: 'state',
      driver: { name: null, isYou: true },
      agentHeld: false,
      waking: false,
      transport: 'vnc',
      viewers: 0,
    });
  });

  it('parses the errors a running computer ends with when its screen is gone', () => {
    expect(
      parseServerMessage(
        JSON.stringify({
          type: 'error',
          code: 'tunnelFailed',
          message: 'screen unreachable',
        })
      )
    ).toEqual({
      type: 'error',
      code: 'tunnelFailed',
      message: 'screen unreachable',
    });
    expect(
      parseServerMessage(
        JSON.stringify({
          type: 'error',
          code: 'sourceUnavailable',
          message: 'display closed',
        })
      )
    ).toEqual({
      type: 'error',
      code: 'sourceUnavailable',
      message: 'display closed',
    });
    expect(
      parseServerMessage(
        JSON.stringify({
          type: 'error',
          code: 'tooManySockets',
          message: 'too many sockets',
        })
      )
    ).toEqual({
      type: 'error',
      code: 'tooManySockets',
      message: 'too many sockets',
    });
    expect(
      parseServerMessage(
        JSON.stringify({
          type: 'error',
          code: 'staleHandBack',
          message: 'That drive already ended; nothing was handed back.',
        })
      )
    ).toMatchObject({ type: 'error', code: 'staleHandBack' });
  });

  it('keeps an error or an end whose code this client does not know', () => {
    expect(
      parseServerMessage(
        JSON.stringify({ type: 'error', code: 'brandNew', message: 'new' })
      )
    ).toEqual({ type: 'error', code: 'unknown', message: 'new' });
    expect(
      parseServerMessage(JSON.stringify({ type: 'ended', reason: 'brandNew' }))
    ).toEqual({ type: 'ended', reason: 'error' });
  });

  it('parses the idle end and the refused take-over the server sends', () => {
    expect(
      parseServerMessage(JSON.stringify({ type: 'ended', reason: 'idle' }))
    ).toEqual({ type: 'ended', reason: 'idle' });
    expect(
      parseServerMessage(
        JSON.stringify({
          type: 'error',
          code: 'agentNotPausable',
          message: 'could not freeze the agent',
        })
      )
    ).toEqual({
      type: 'error',
      code: 'agentNotPausable',
      message: 'could not freeze the agent',
    });
    expect(
      parseServerMessage(
        JSON.stringify({
          type: 'error',
          code: 'takeOverUnavailable',
          message: 'access check failed',
        })
      )
    ).toEqual({
      type: 'error',
      code: 'takeOverUnavailable',
      message: 'access check failed',
    });
  });
});

class FakeSocket extends EventTarget {
  readyState: number = WebSocket.CONNECTING;
  sent: unknown[] = [];
  send(data: string) {
    this.sent.push(JSON.parse(data));
  }
  open() {
    this.readyState = WebSocket.OPEN;
    this.dispatchEvent(new Event('open'));
  }
  close() {
    this.readyState = WebSocket.CLOSED;
    this.dispatchEvent(new CloseEvent('close'));
  }
}

describe('reportVisibility', () => {
  let visibility: DocumentVisibilityState = 'visible';
  const setVisibility = (next: DocumentVisibilityState) => {
    visibility = next;
    document.dispatchEvent(new Event('visibilitychange'));
  };
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    visibility = 'visible';
  });

  it('says whether the tab is shown on open, on every change and every minute while shown, until the socket closes', () => {
    vi.useFakeTimers();
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(
      () => visibility
    );
    const socket = new FakeSocket();
    reportVisibility(socket as unknown as WebSocket);
    expect(socket.sent).toEqual([]);

    socket.open();
    expect(socket.sent).toEqual([{ type: 'visibility', visible: true }]);

    vi.advanceTimersByTime(VISIBILITY_HEARTBEAT_MS);
    expect(socket.sent).toHaveLength(2);
    expect(socket.sent[1]).toEqual({ type: 'visibility', visible: true });

    setVisibility('hidden');
    expect(socket.sent[2]).toEqual({ type: 'visibility', visible: false });
    // Hidden: no heartbeat, so the server's clock runs out.
    vi.advanceTimersByTime(VISIBILITY_HEARTBEAT_MS * 3);
    expect(socket.sent).toHaveLength(3);

    setVisibility('visible');
    expect(socket.sent[3]).toEqual({ type: 'visibility', visible: true });

    socket.close();
    // Nothing keeps running for a closed socket.
    expect(vi.getTimerCount()).toBe(0);
    setVisibility('hidden');
    vi.advanceTimersByTime(VISIBILITY_HEARTBEAT_MS * 3);
    expect(socket.sent).toHaveLength(4);
  });
});
