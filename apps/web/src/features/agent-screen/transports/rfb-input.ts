import { match } from 'ts-pattern';
import { KEYSYM_RETURN, keysymForCharacter } from '../core/keysym';
import type { ScreenInputEvent } from './types';

/**
 * Client-to-server RFB messages (RFC 6143 §7.5) for guest input on the vnc
 * transport.
 */

const KEY_EVENT = 4;
const POINTER_EVENT = 5;
const CLIENT_CUT_TEXT = 6;

/** RFB wheel buttons: 4 up, 5 down, 6 left, 7 right, as mask bits. */
const WHEEL_UP = 1 << 3;
const WHEEL_DOWN = 1 << 4;
const WHEEL_LEFT = 1 << 5;
const WHEEL_RIGHT = 1 << 6;

function pointerEvent(
  x: number,
  y: number,
  mask: number
): Uint8Array<ArrayBuffer> {
  const message = new Uint8Array(6);
  const view = new DataView(message.buffer);
  view.setUint8(0, POINTER_EVENT);
  view.setUint8(1, mask);
  view.setUint16(2, x);
  view.setUint16(4, y);
  return message;
}

function keyEvent(keysym: number, down: boolean): Uint8Array<ArrayBuffer> {
  const message = new Uint8Array(8);
  const view = new DataView(message.buffer);
  view.setUint8(0, KEY_EVENT);
  view.setUint8(1, down ? 1 : 0);
  view.setUint32(4, keysym);
  return message;
}

function clientCutText(text: string): Uint8Array<ArrayBuffer> {
  // Plain ClientCutText is Latin-1; anything else becomes '?'.
  const bytes = Array.from(text, (character) => {
    const codePoint = character.codePointAt(0) ?? 0x3f;
    return codePoint <= 0xff ? codePoint : 0x3f;
  });
  const message = new Uint8Array(8 + bytes.length);
  const view = new DataView(message.buffer);
  view.setUint8(0, CLIENT_CUT_TEXT);
  view.setUint32(4, bytes.length);
  message.set(bytes, 8);
  return message;
}

/** One press and release of a wheel button per notch. */
function wheelClicks(
  x: number,
  y: number,
  notches: number,
  positive: number,
  negative: number
) {
  const button = notches > 0 ? positive : negative;
  return Array.from({ length: Math.abs(notches) }, () => [
    pointerEvent(x, y, button),
    pointerEvent(x, y, 0),
  ]).flat();
}

function typeText(text: string): Uint8Array<ArrayBuffer>[] {
  return Array.from(text).flatMap((character) => {
    const keysym =
      character === '\n' ? KEYSYM_RETURN : keysymForCharacter(character);
    if (keysym === undefined) return [];
    return [keyEvent(keysym, true), keyEvent(keysym, false)];
  });
}

const SET_ENCODINGS = 2;
/**
 * Pseudo-encodings a view-only noVNC must not ask for:
 * - Cursor and VMware cursor, so the server draws the pointer into the
 *   picture and watchers see the agent's cursor move.
 * - ExtendedClipboard: view-only noVNC returns from an extended Provide
 *   without reading its zlib payload, so a guest selection (Ctrl+A on a page)
 *   desyncs the stream. Without it Xvnc sends a plain ServerCutText, which
 *   noVNC reads and ignores.
 */
const STRIPPED_ENCODINGS = [-239, 0x574d5664, 0xc0a1e5ce | 0];

/**
 * A SetEncodings message without the pseudo-encodings a view-only noVNC
 * must not ask for (`STRIPPED_ENCODINGS`). Any other message comes back
 * unchanged.
 */
export function viewOnlyEncodings(
  message: Uint8Array<ArrayBuffer>
): Uint8Array<ArrayBuffer> {
  if (message.length < 4 || message[0] !== SET_ENCODINGS) return message;
  const view = new DataView(
    message.buffer,
    message.byteOffset,
    message.byteLength
  );
  const count = view.getUint16(2);
  if (message.length !== 4 + count * 4) return message;

  const kept: number[] = [];
  for (let index = 0; index < count; index++) {
    const encoding = view.getInt32(4 + index * 4);
    if (!STRIPPED_ENCODINGS.includes(encoding)) kept.push(encoding);
  }

  const rewritten = new Uint8Array(4 + kept.length * 4);
  const out = new DataView(rewritten.buffer);
  out.setUint8(0, SET_ENCODINGS);
  out.setUint16(2, kept.length);
  kept.forEach((encoding, index) => out.setInt32(4 + index * 4, encoding));
  return rewritten;
}

export function encodeInput(
  event: ScreenInputEvent
): Uint8Array<ArrayBuffer>[] {
  return match(event)
    .with({ kind: 'pointer' }, ({ x, y, buttons }) => [
      pointerEvent(x, y, buttons),
    ])
    .with({ kind: 'key' }, ({ keysym, down }) => [keyEvent(keysym, down)])
    .with({ kind: 'text' }, ({ text }) => typeText(text))
    .with({ kind: 'scroll' }, ({ x, y, dx, dy }) => [
      ...wheelClicks(x, y, dy, WHEEL_DOWN, WHEEL_UP),
      ...wheelClicks(x, y, dx, WHEEL_RIGHT, WHEEL_LEFT),
    ])
    .with({ kind: 'clipboard' }, ({ text }) => [clientCutText(text)])
    .exhaustive();
}
