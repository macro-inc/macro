import { describe, expect, it } from 'vitest';
import { encodeInput, withoutCursorEncodings } from './rfb-input';

const bytes = (messages: Uint8Array[]) =>
  messages.map((message) => [...message]);

describe('encodeInput', () => {
  it('writes a PointerEvent with big-endian coordinates', () => {
    expect(
      bytes(encodeInput({ kind: 'pointer', x: 300, y: 1079, buttons: 1 }))
    ).toEqual([[5, 1, 0x01, 0x2c, 0x04, 0x37]]);
  });

  it('writes a KeyEvent', () => {
    expect(
      bytes(encodeInput({ kind: 'key', keysym: 0xff0d, down: true }))
    ).toEqual([[4, 1, 0, 0, 0, 0, 0xff, 0x0d]]);
  });

  it('types text as press and release per character, Enter for a new line', () => {
    expect(bytes(encodeInput({ kind: 'text', text: 'a\n' }))).toEqual([
      [4, 1, 0, 0, 0, 0, 0, 0x61],
      [4, 0, 0, 0, 0, 0, 0, 0x61],
      [4, 1, 0, 0, 0, 0, 0xff, 0x0d],
      [4, 0, 0, 0, 0, 0, 0xff, 0x0d],
    ]);
  });

  it('scrolls with one wheel-button click per notch', () => {
    expect(
      bytes(encodeInput({ kind: 'scroll', x: 1, y: 2, dx: 0, dy: -2 }))
    ).toEqual([
      [5, 8, 0, 1, 0, 2],
      [5, 0, 0, 1, 0, 2],
      [5, 8, 0, 1, 0, 2],
      [5, 0, 0, 1, 0, 2],
    ]);
    expect(
      bytes(encodeInput({ kind: 'scroll', x: 1, y: 2, dx: 1, dy: 1 }))
    ).toEqual([
      [5, 16, 0, 1, 0, 2],
      [5, 0, 0, 1, 0, 2],
      [5, 64, 0, 1, 0, 2],
      [5, 0, 0, 1, 0, 2],
    ]);
  });

  it('sends the clipboard as Latin-1 ClientCutText', () => {
    expect(bytes(encodeInput({ kind: 'clipboard', text: 'hé€' }))).toEqual([
      [6, 0, 0, 0, 0, 0, 0, 3, 0x68, 0xe9, 0x3f],
    ]);
  });
});

describe('withoutCursorEncodings', () => {
  it('drops the cursor pseudo-encodings from SetEncodings', () => {
    // Tight (7), Cursor (-239), Raw (0), VMware cursor (0x574d5664).
    const message = new Uint8Array([
      2, 0, 0, 4, 0, 0, 0, 7, 0xff, 0xff, 0xff, 0x11, 0, 0, 0, 0, 0x57, 0x4d,
      0x56, 0x64,
    ]);
    expect([...withoutCursorEncodings(message)]).toEqual([
      2, 0, 0, 2, 0, 0, 0, 7, 0, 0, 0, 0,
    ]);
  });

  it('leaves other messages alone', () => {
    const update = new Uint8Array([3, 1, 0, 0, 0, 0, 7, 128, 4, 56]);
    expect(withoutCursorEncodings(update)).toBe(update);
  });
});
