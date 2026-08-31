import type { MinimalWebSocket } from '@macro-inc/collaboration/websocket';
import { describe, expect, it } from 'vitest';
import { createSyncSocketDiagnostics } from './sync-diagnostics';

type Listener = (event: never) => void;

/** Fake native socket: records listeners so the test can fire raw events. */
class FakeNativeSocket {
  binaryType = 'blob';
  readyState = 0;
  private readonly listeners = new Map<string, Set<Listener>>();

  addEventListener(type: string, listener: Listener) {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(listener);
  }

  removeEventListener(type: string, listener: Listener) {
    this.listeners.get(type)?.delete(listener);
  }

  fire(type: string, event: unknown) {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event as never);
    }
  }
}

function createDiagnosticsWithSocket() {
  const sockets: FakeNativeSocket[] = [];
  const diagnostics = createSyncSocketDiagnostics(() => {
    const socket = new FakeNativeSocket();
    sockets.push(socket);
    return socket as unknown as MinimalWebSocket;
  });
  return { diagnostics, sockets };
}

describe('createSyncSocketDiagnostics', () => {
  it('reports a connection that never opened', () => {
    const { diagnostics, sockets } = createDiagnosticsWithSocket();
    diagnostics.factory('wss://example', undefined);
    sockets[0].fire('close', { code: 1006, reason: '', wasClean: false });

    expect(diagnostics.attrs()).toMatchObject({
      'sync.ws.connect_attempts': 1,
      'sync.ws.opened': false,
      'sync.ws.raw_frames': 0,
      'sync.ws.decoded_frames': 0,
      'sync.ws.close.code': 1006,
      'sync.ws.close.clean': false,
    });
    expect(diagnostics.summary()).toBe(
      'attempts=1 opened=false raw_frames=0 decoded=0 close=1006'
    );
  });

  it('reports a raw frame that never decoded (Blob delivery)', () => {
    const { diagnostics, sockets } = createDiagnosticsWithSocket();
    diagnostics.factory('wss://example', undefined);
    const socket = sockets[0];
    socket.binaryType = 'arraybuffer';
    socket.fire('open', {});
    socket.fire('message', { data: new Blob([new Uint8Array(16)]) });

    const attrs = diagnostics.attrs();
    expect(attrs).toMatchObject({
      'sync.ws.opened': true,
      'sync.ws.raw_frames': 1,
      'sync.ws.decoded_frames': 0,
      'sync.ws.first_frame.type': 'Blob',
      'sync.ws.first_frame.bytes': 16,
      'sync.ws.binary_type': 'arraybuffer',
    });
    expect(diagnostics.summary()).toBe(
      'attempts=1 opened=true raw_frames=1 decoded=0 first_frame=Blob'
    );
  });

  it('keeps first-frame details while counting later frames and decodes', () => {
    const { diagnostics, sockets } = createDiagnosticsWithSocket();
    diagnostics.factory('wss://example', undefined);
    const socket = sockets[0];
    socket.binaryType = 'arraybuffer';
    socket.fire('open', {});
    socket.fire('message', { data: new ArrayBuffer(30770) });
    socket.fire('message', { data: new ArrayBuffer(4) });
    diagnostics.recordDecoded('initial_sync');
    diagnostics.recordDecoded('update_ack');

    expect(diagnostics.attrs()).toMatchObject({
      'sync.ws.raw_frames': 2,
      'sync.ws.decoded_frames': 2,
      'sync.ws.first_frame.type': 'ArrayBuffer',
      'sync.ws.first_frame.bytes': 30770,
      'sync.ws.decoded_kinds': 'initial_sync,update_ack',
    });
  });

  it('records hex prefix and probe decode for the first binary frame', () => {
    const { diagnostics, sockets } = createDiagnosticsWithSocket();
    diagnostics.factory('wss://example', undefined);
    const socket = sockets[0];
    socket.binaryType = 'arraybuffer';
    socket.fire('open', {});
    socket.fire('message', {
      data: new Uint8Array([0xff, 0xfe, 0xfd]).buffer,
    });

    const attrs = diagnostics.attrs();
    expect(attrs['sync.ws.first_frame.hex']).toBe('fffefd');
    expect(String(attrs['sync.ws.first_frame.probe'])).toMatch(/^err:/);
    // The trail includes per-listener entries (lN.msg / lN.ok) around the
    // frame observation from the diagnostics' own message listener.
    expect(String(attrs['sync.ws.events'])).toMatch(
      /^connect\+\d+ms,open\+\d+ms,l\d+\.msg\+\d+ms,frame\(3\)\+\d+ms,l\d+\.ok\+\d+ms$/
    );
    expect(diagnostics.summary()).toContain('probe=err:');
  });

  it('contains and records a throwing native listener', () => {
    const { diagnostics, sockets } = createDiagnosticsWithSocket();
    diagnostics.factory('wss://example', undefined);
    const socket = sockets[0];
    // Registered through the patched addEventListener, like the wrapper's.
    (socket as unknown as MinimalWebSocket).addEventListener('message', () => {
      throw new Error('boom in listener');
    });

    socket.fire('open', {});
    socket.fire('message', { data: new ArrayBuffer(4) });

    const attrs = diagnostics.attrs();
    expect(attrs['sync.ws.listener_errors']).toBe(1);
    expect(String(attrs['sync.ws.first_listener_error'])).toContain(
      'boom in listener'
    );
    // The frame was still observed despite the throwing listener.
    expect(attrs['sync.ws.raw_frames']).toBe(1);
    expect(diagnostics.summary()).toContain('listener_errors=1');
  });

  it('counts retries as separate connect attempts and errors', () => {
    const { diagnostics, sockets } = createDiagnosticsWithSocket();
    diagnostics.factory('wss://example', undefined);
    sockets[0].fire('error', {});
    sockets[0].fire('close', {
      code: 1002,
      reason: 'protocol',
      wasClean: false,
    });
    diagnostics.factory('wss://example', undefined);
    sockets[1].fire('error', {});

    expect(diagnostics.attrs()).toMatchObject({
      'sync.ws.connect_attempts': 2,
      'sync.ws.error_events': 2,
      'sync.ws.close.code': 1002,
      'sync.ws.close.reason': 'protocol',
    });
    expect(diagnostics.summary()).toBe(
      'attempts=2 opened=false raw_frames=0 decoded=0 close=1002 errors=2'
    );
  });
});
