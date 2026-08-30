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

import {
  platformWebSocketFactory,
  type WebSocketFactory,
} from '@macro-inc/collaboration/websocket';
import type { Attribute } from '@macro-inc/observability';

const MAX_DECODED_KINDS = 10;

export type SyncSocketDiagnostics = {
  /** Hand to {@link createSyncSocket} so raw socket events are observed. */
  factory: WebSocketFactory;
  /** Record a message that made it through deserialization. */
  recordDecoded(kind: string): void;
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

  const factory: WebSocketFactory = (url, protocols) => {
    const socket = create(url, protocols);
    connectAttempts += 1;
    socket.addEventListener('open', () => {
      opened = true;
    });
    socket.addEventListener('error', () => {
      errorEvents += 1;
    });
    socket.addEventListener('close', (event) => {
      lastClose = {
        code: event.code,
        reason: event.reason,
        wasClean: event.wasClean,
      };
    });
    socket.addEventListener('message', (event) => {
      rawFrames += 1;
      firstFrame ??= {
        type: frameType(event.data),
        bytes: frameBytes(event.data),
        // As seen when the frame arrived — the wrapper sets 'arraybuffer',
        // so anything else here means the runtime ignored the setter.
        binaryType: socket.binaryType,
      };
    });
    return socket;
  };

  return {
    factory,
    recordDecoded(kind: string): void {
      decodedFrames += 1;
      if (decodedKinds.length < MAX_DECODED_KINDS) decodedKinds.push(kind);
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
      }
      if (decodedKinds.length > 0) {
        attrs['sync.ws.decoded_kinds'] = decodedKinds.join(',');
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
