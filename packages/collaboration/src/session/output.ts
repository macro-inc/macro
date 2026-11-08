import { ABI_MAJOR, DIFF_FORMAT_VERSION, ViewEffectMsg } from './abi.generated';

export const Flag = {
  View: 1,
  Io: 2,
  WakeChanged: 4,
  NeedPeerIds: 8,
  Error: 16,
} as const;
export interface Effect {
  tag: number;
  a: number;
  b: number;
  payload: Uint8Array;
}
/** Output owns its buffer; every payload stays valid across wasm memory growth. */
export function decodeOutput(bytes: Uint8Array) {
  const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let at = 0;
  const word = () => {
    if (at + 4 > bytes.byteLength) throw new Error('Truncated session output');
    const v = data.getUint32(at, true);
    at += 4;
    return v;
  };
  if (
    word() !== 0x4d534553 ||
    (word() & 0xffff) !== ABI_MAJOR ||
    word() !== DIFF_FORMAT_VERSION
  )
    throw new Error('AbiMismatch');
  const words = word(),
    strings = word(),
    count = word();
  const blob = (len: number) => {
    if (len > bytes.byteLength - at)
      throw new Error('Truncated session payload');
    const value = bytes.subarray(at, at + len);
    at += len;
    at = (at + 3) & ~3;
    if (at > bytes.byteLength) throw new Error('Missing session alignment');
    return value;
  };
  const viewBytes = blob(words * 4);
  const view = new Uint32Array(viewBytes.buffer, viewBytes.byteOffset, words);
  const text = blob(strings);
  const effects: Effect[] = [];
  const viewEffects = [];
  for (let i = 0; i < count; i++) {
    const tag = word(),
      a = word(),
      b = word(),
      len = word();
    const payload = blob(len);
    if (tag === 16) viewEffects.push(ViewEffectMsg.decode(payload));
    else effects.push({ tag, a, b, payload });
  }
  if (at !== bytes.byteLength) throw new Error('Trailing session output');
  return { view, strings: text, viewEffects, effects };
}
