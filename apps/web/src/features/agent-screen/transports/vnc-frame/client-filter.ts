import { match } from 'ts-pattern';
import { viewOnlyEncodings } from '../rfb-input';

/** The client's ProtocolVersion, e.g. `RFB 003.008\n`. */
const VERSION_BYTES = 12;

/**
 * After the version, what else the client sends before its first message:
 * a security type (3.7 and 3.8 only) and ClientInit. The server's gate
 * accepts the same versions; security is always None.
 */
const AFTER_VERSION_BYTES: Record<string, number> = {
  'RFB 003.003\n': 1,
  'RFB 003.007\n': 2,
  'RFB 003.008\n': 2,
};

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
 * view-only client sends, with `viewOnlyEncodings` applied. Anything
 * it can't frame throws: the stream can't be trusted past it.
 */
export function createRfbClientFilter() {
  let versionKnown = false;
  let handshakeLeft = 0;
  let buffer = new Uint8Array(0);
  let dropped = 0;

  return {
    push(chunk: Uint8Array): Uint8Array<ArrayBuffer>[] {
      const out: Uint8Array<ArrayBuffer>[] = [];
      const joined = new Uint8Array(buffer.length + chunk.length);
      joined.set(buffer);
      joined.set(chunk, buffer.length);
      let rest = joined;

      if (!versionKnown) {
        if (rest.length < VERSION_BYTES) {
          buffer = rest.slice();
          return out;
        }
        const version = new TextDecoder().decode(
          rest.subarray(0, VERSION_BYTES)
        );
        const after = AFTER_VERSION_BYTES[version];
        if (after === undefined) {
          throw new Error(`unsupported RFB version ${JSON.stringify(version)}`);
        }
        out.push(rest.slice(0, VERSION_BYTES));
        rest = rest.subarray(VERSION_BYTES);
        versionKnown = true;
        handshakeLeft = after;
      }

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
        out.push(viewOnlyEncodings(rest.slice(0, allowed)));
        rest = rest.subarray(allowed);
      }
      buffer = rest.slice();
      return out;
    },
    /** Messages dropped so far, for telemetry. */
    dropped: () => dropped,
  };
}
