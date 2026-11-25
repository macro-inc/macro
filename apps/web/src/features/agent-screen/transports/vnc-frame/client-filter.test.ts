import { describe, expect, it } from 'vitest';
import { createRfbClientFilter } from './client-filter';

const bytes = (...values: number[]) => new Uint8Array(values);

describe('createRfbClientFilter', () => {
  it("passes the handshake and a view-only client's messages, and drops input the frame must never send", () => {
    const filter = createRfbClientFilter();
    const passed: number[][] = [];
    const push = (chunk: Uint8Array) => {
      for (const message of filter.push(chunk)) passed.push([...message]);
    };

    // ProtocolVersion (12), security type None (1), ClientInit shared (1).
    push(new TextEncoder().encode('RFB 003.008\n'));
    push(bytes(1, 1));
    // SetPixelFormat (20 bytes), split across two chunks.
    push(bytes(0, 0, 0, 0, 32, 24, 0, 1, 0, 255));
    push(bytes(0, 255, 0, 255, 16, 8, 0, 0, 0, 0));
    // FramebufferUpdateRequest (10).
    push(bytes(3, 0, 0, 0, 0, 0, 7, 128, 4, 56));
    // A KeyEvent and a PointerEvent from a compromised frame: dropped.
    push(bytes(4, 1, 0, 0, 0, 0, 0, 0x61));
    push(bytes(5, 1, 0, 10, 0, 10));
    // ClientFence (9 + 0).
    push(bytes(248, 0, 0, 0, 0, 0, 0, 1, 0));

    expect(passed).toEqual([
      [...new TextEncoder().encode('RFB 003.008\n')],
      [1, 1],
      [0, 0, 0, 0, 32, 24, 0, 1, 0, 255, 0, 255, 0, 255, 16, 8, 0, 0, 0, 0],
      [3, 0, 0, 0, 0, 0, 7, 128, 4, 56],
      [248, 0, 0, 0, 0, 0, 0, 1, 0],
    ]);
    expect(filter.dropped()).toBe(2);
  });

  it('strips the cursor pseudo-encodings from SetEncodings', () => {
    const filter = createRfbClientFilter();
    filter.push(new TextEncoder().encode('RFB 003.008\n'));
    filter.push(bytes(1, 1));
    // SetEncodings: Raw (0), Cursor (-239).
    const [message] = filter.push(
      bytes(2, 0, 0, 2, 0, 0, 0, 0, 0xff, 0xff, 0xff, 0x11)
    );
    expect([...message]).toEqual([2, 0, 0, 1, 0, 0, 0, 0]);
  });

  it('stops at a message it cannot frame instead of guessing', () => {
    const filter = createRfbClientFilter();
    filter.push(new TextEncoder().encode('RFB 003.008\n'));
    filter.push(bytes(1, 1));
    expect(() => filter.push(bytes(77, 1, 2, 3))).toThrow(
      'unknown RFB client message 77'
    );
  });

  it('follows the version the client speaks: 3.3 sends no security type, others are refused', () => {
    const old = createRfbClientFilter();
    const sent = [
      ...old.push(new TextEncoder().encode('RFB 003.003\n')),
      // ClientInit, then SetPixelFormat right away: no security byte in 3.3.
      ...old.push(new Uint8Array([1])),
      ...old.push(new Uint8Array(20)),
    ];
    expect(sent.map((bytes) => bytes.length)).toEqual([12, 1, 20]);

    // A version split across chunks waits for the rest.
    const split = createRfbClientFilter();
    expect(split.push(new TextEncoder().encode('RFB 003'))).toEqual([]);
    expect(split.push(new TextEncoder().encode('.008\n'))).toHaveLength(1);

    expect(() =>
      createRfbClientFilter().push(new TextEncoder().encode('RFB 004.001\n'))
    ).toThrow('unsupported RFB version');
  });
});
