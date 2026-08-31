/**
 * Passive diagnostics for the worker's sync WebSocket, built to explain
 * `edit.sync_init` timeouts. Every prod timeout so far surfaced as an opaque
 * "initial sync failed: timeout (10000ms)"; these counters distinguish the
 * three failure modes: the socket never opened, a raw frame arrived but never
 * decoded (e.g. Blob delivered where the Bebop serializer expects an
 * ArrayBuffer), or frames decoded fine but no RemoteInitialSync was sent.
 *
 * Observation only: the factory wraps the platform default and merely attaches
 * extra listeners to the native socket, so transport behavior is unchanged.
 */

import { FromRemote } from '@macro-inc/collaboration/sync-service/generated/schema';
import {
  platformWebSocketFactory,
  type WebSocketFactory,
} from '@macro-inc/collaboration/websocket';
import type { Attribute } from '@macro-inc/observability';

const MAX_DECODED_KINDS = 10;
const MAX_EVENTS = 12;
const HEX_PREFIX_BYTES = 24;

export type SyncSocketDiagnostics = {
  /** Hand to {@link createSyncSocket} so raw socket events are observed. */
  factory: WebSocketFactory;
  /** Record a message that made it through deserialization. */
  recordDecoded(kind: string): void;
  /** Record a frame the serializer failed to deserialize. */
  recordDecodeFailure(error: unknown): void;
  /** Flat span attributes describing everything observed so far. */
  attrs(): Record<string, Attribute>;
  /** One-line summary for error messages, e.g. "opened=false raw_frames=0". */
  summary(): string;
};

/** Raw `MessageEvent.data` type without reading the bytes. */
function frameType(data: unknown): string {
  if (typeof data === 'string') return 'string';
  if (data instanceof ArrayBuffer) return 'ArrayBuffer';
  if (typeof Blob !== 'undefined' && data instanceof Blob) return 'Blob';
  if (ArrayBuffer.isView(data)) return data.constructor.name;
  if (data === null || data === undefined) return String(data);
  return (
    (data as { constructor?: { name?: string } }).constructor?.name ??
    typeof data
  );
}

function frameBytes(data: unknown): number | undefined {
  if (typeof data === 'string') return data.length;
  if (data instanceof ArrayBuffer) return data.byteLength;
  if (typeof Blob !== 'undefined' && data instanceof Blob) return data.size;
  if (ArrayBuffer.isView(data)) return data.byteLength;
  return undefined;
}

/** Synchronous byte view of frame data; undefined for Blob (async-only). */
function frameView(data: unknown): Uint8Array | undefined {
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) {
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  }
  return undefined;
}

function hexPrefix(view: Uint8Array): string {
  let out = '';
  const n = Math.min(view.length, HEX_PREFIX_BYTES);
  for (let i = 0; i < n; i++) {
    out += view[i].toString(16).padStart(2, '0');
  }
  return out;
}

function errorText(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 160);
}

/**
 * What the first frame's bytes actually are: an independent decode attempt
 * against the Bebop schema, recorded so a decode failure in the transport
 * shows up with its exception text instead of as a silent `decoded=0`.
 */
function probeDecode(view: Uint8Array): string {
  try {
    const message = FromRemote.decode(view);
    if (message.isRemoteInitialSync()) return 'ok:initial_sync';
    if (message.isRemoteUpdate()) return 'ok:update';
    if (message.isRemoteAwareness()) return 'ok:awareness';
    if (message.isRemoteSnapshot()) return 'ok:snapshot';
    if (message.isRemoteUpdateAck()) return 'ok:update_ack';
    if (message.isRemoteUpdateSince()) return 'ok:update_since';
    return 'ok:unknown';
  } catch (error) {
    return `err:${errorText(error)}`;
  }
}

export function createSyncSocketDiagnostics(
  create: WebSocketFactory = platformWebSocketFactory
): SyncSocketDiagnostics {
  let connectAttempts = 0;
  let opened = false;
  let errorEvents = 0;
  let rawFrames = 0;
  let firstFrame:
    | { type: string; bytes?: number; binaryType: string }
    | undefined;
  let lastClose:
    | { code: number; reason: string; wasClean: boolean }
    | undefined;
  let decodedFrames = 0;
  const decodedKinds: string[] = [];
  let decodeFailures = 0;
  let firstDecodeError: string | undefined;
  let firstFrameHex: string | undefined;
  let firstFrameProbe: string | undefined;
  // Ordered event log with ms offsets from diagnostics creation, so "did the
  // error fire before or after the frame" is answerable from the span.
  const startedAt = Date.now();
  const events: string[] = [];
  const logEvent = (name: string) => {
    if (events.length < MAX_EVENTS) {
      events.push(`${name}+${Date.now() - startedAt}ms`);
    }
  };

  // These listeners are attached to the native socket ahead of the transport
  // wrapper's own handlers. A listener exception here could suppress the
  // wrapper's dispatch for that event (or, under workerd's fail-fast event
  // dispatch, error out the socket) — the one way observation could break
  // delivery. Nothing below should be able to throw; swallow anyway so
  // diagnostics can never cause the failure they measure.
  const observe = <E>(record: (event: E) => void): ((event: E) => void) => {
    return (event) => {
      try {
        record(event);
      } catch {
        /* never let diagnostics interfere with delivery */
      }
    };
  };

  const factory: WebSocketFactory = (url, protocols) => {
    const socket = create(url, protocols);
    connectAttempts += 1;
    logEvent('connect');
    socket.addEventListener(
      'open',
      observe(() => {
        opened = true;
        logEvent('open');
      })
    );
    socket.addEventListener(
      'error',
      observe(() => {
        errorEvents += 1;
        logEvent('error');
      })
    );
    socket.addEventListener(
      'close',
      observe((event) => {
        lastClose = {
          code: event.code,
          reason: event.reason,
          wasClean: event.wasClean,
        };
        logEvent(`close(${event.code})`);
      })
    );
    socket.addEventListener(
      'message',
      observe((event) => {
        rawFrames += 1;
        logEvent(`frame(${frameBytes(event.data) ?? '?'})`);
        if (firstFrame === undefined) {
          firstFrame = {
            type: frameType(event.data),
            bytes: frameBytes(event.data),
            // As seen when the frame arrived — the wrapper sets 'arraybuffer',
            // so anything else here means the runtime ignored the setter.
            binaryType: socket.binaryType,
          };
          const view = frameView(event.data);
          if (view) {
            firstFrameHex = hexPrefix(view);
            firstFrameProbe = probeDecode(view);
          }
        }
      })
    );
    return socket;
  };

  return {
    factory,
    recordDecoded(kind: string): void {
      decodedFrames += 1;
      if (decodedKinds.length < MAX_DECODED_KINDS) decodedKinds.push(kind);
    },
    recordDecodeFailure(error: unknown): void {
      decodeFailures += 1;
      firstDecodeError ??= errorText(error);
      logEvent('decode_failure');
    },
    attrs(): Record<string, Attribute> {
      const attrs: Record<string, Attribute> = {
        'sync.ws.connect_attempts': connectAttempts,
        'sync.ws.opened': opened,
        'sync.ws.error_events': errorEvents,
        'sync.ws.raw_frames': rawFrames,
        'sync.ws.decoded_frames': decodedFrames,
      };
      if (firstFrame) {
        attrs['sync.ws.first_frame.type'] = firstFrame.type;
        attrs['sync.ws.binary_type'] = firstFrame.binaryType;
        if (firstFrame.bytes !== undefined) {
          attrs['sync.ws.first_frame.bytes'] = firstFrame.bytes;
        }
        if (firstFrameHex !== undefined) {
          attrs['sync.ws.first_frame.hex'] = firstFrameHex;
        }
        if (firstFrameProbe !== undefined) {
          attrs['sync.ws.first_frame.probe'] = firstFrameProbe;
        }
      }
      if (decodeFailures > 0) {
        attrs['sync.ws.decode_failures'] = decodeFailures;
        if (firstDecodeError !== undefined) {
          attrs['sync.ws.first_decode_error'] = firstDecodeError;
        }
      }
      if (decodedKinds.length > 0) {
        attrs['sync.ws.decoded_kinds'] = decodedKinds.join(',');
      }
      if (events.length > 0) {
        attrs['sync.ws.events'] = events.join(',');
      }
      if (lastClose) {
        attrs['sync.ws.close.code'] = lastClose.code;
        attrs['sync.ws.close.clean'] = lastClose.wasClean;
        if (lastClose.reason) {
          attrs['sync.ws.close.reason'] = lastClose.reason.slice(0, 256);
        }
      }
      return attrs;
    },
    summary(): string {
      const parts = [
        `attempts=${connectAttempts}`,
        `opened=${opened}`,
        `raw_frames=${rawFrames}`,
        `decoded=${decodedFrames}`,
      ];
      if (firstFrame) {
        parts.push(`first_frame=${firstFrame.type}`);
      }
      if (firstFrameProbe !== undefined) {
        parts.push(`probe=${firstFrameProbe}`);
      }
      if (decodeFailures > 0) {
        parts.push(`decode_failures=${decodeFailures}`);
      }
      if (lastClose) {
        parts.push(`close=${lastClose.code}`);
      }
      if (errorEvents > 0) {
        parts.push(`errors=${errorEvents}`);
      }
      return parts.join(' ');
    },
  };
}
