import { match } from 'ts-pattern';
import { withoutCursorEncodings } from '../rfb-input';

/** ProtocolVersion (12) + security type (1) + ClientInit (1). */
const HANDSHAKE_BYTES = 14;

const SET_PIXEL_FORMAT = 0;
const SET_ENCODINGS = 2;
const FRAMEBUFFER_UPDATE_REQUEST = 3;
const ENABLE_CONTINUOUS_UPDATES = 150;
const CLIENT_FENCE = 248;

/**
 * What a view-only noVNC legitimately sends, and how long each message is
 * (`undefined` until enough bytes are in). KeyEvent, PointerEvent and
 * ClientCutText are not here: the viewer writes input itself, so input coming
 * out of the frame would be a decoder bug speaking for the person driving.
 */
function allowedLength(bytes: Uint8Array): number | undefined | 'unknown' {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return match(bytes[0])
    .returnType<number | undefined | 'unknown'>()
    .with(SET_PIXEL_FORMAT, () => 20)
    .with(SET_ENCODINGS, () =>
      bytes.length >= 4 ? 4 + 4 * view.getUint16(2) : undefined
    )
    .with(FRAMEBUFFER_UPDATE_REQUEST, ENABLE_CONTINUOUS_UPDATES, () => 10)
    .with(CLIENT_FENCE, () => (bytes.length >= 9 ? 9 + bytes[8] : undefined))
    .otherwise(() => 'unknown');
}

/** Input messages, framed only so they can be dropped whole. */
function inputLength(bytes: Uint8Array): number | undefined {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes[0] === 4) return 8; // KeyEvent
  if (bytes[0] === 5) return 6; // PointerEvent
  if (bytes[0] === 6) {
    // ClientCutText; a negative length is the extended clipboard's.
    return bytes.length >= 8 ? 8 + Math.abs(view.getInt32(4)) : undefined;
  }
  return undefined;
}

/**
 * Splits what the sandboxed frame sends towards the server into whole RFB
 * client messages and lets through only the handshake and the messages a
 * view-only client sends, with the cursor pseudo-encodings removed. Anything
 * it can't frame throws: the stream can't be trusted past it.
 */
export function createRfbClientFilter() {
  let handshakeLeft = HANDSHAKE_BYTES;
  let buffer = new Uint8Array(0);
  let dropped = 0;

  return {
    push(chunk: Uint8Array): Uint8Array[] {
      const out: Uint8Array[] = [];
      const joined = new Uint8Array(buffer.length + chunk.length);
      joined.set(buffer);
      joined.set(chunk, buffer.length);
      let rest = joined;

      if (handshakeLeft > 0) {
        const take = Math.min(handshakeLeft, rest.length);
        if (take > 0) out.push(rest.slice(0, take));
        handshakeLeft -= take;
        rest = rest.subarray(take);
      }

      while (rest.length > 0) {
        const allowed = allowedLength(rest);
        if (allowed === 'unknown') {
          const input = inputLength(rest);
          if (input === undefined && [4, 5, 6].includes(rest[0])) break;
          if (input === undefined) {
            throw new Error(`unknown RFB client message ${rest[0]}`);
          }
          if (rest.length < input) break;
          dropped += 1;
          rest = rest.subarray(input);
          continue;
        }
        if (allowed === undefined || rest.length < allowed) break;
        out.push(withoutCursorEncodings(rest.slice(0, allowed)));
        rest = rest.subarray(allowed);
      }
      buffer = rest.slice();
      return out;
    },
    /** Messages dropped so far, for telemetry. */
    dropped: () => dropped,
  };
}
