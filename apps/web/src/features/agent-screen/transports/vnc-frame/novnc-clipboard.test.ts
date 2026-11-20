import { deflateSync } from 'node:zlib';
import RFB, { type RfbChannel } from '@novnc/novnc';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createRfbClientFilter } from './client-filter';

/**
 * The real noVNC, view only as the frame runs it, against an Xvnc-shaped
 * server, with the frame→server filter in between as in the app. A guest
 * selection (Ctrl+A on a page) makes Xvnc send its clipboard, which must not
 * desync the stream.
 */

const EXTENDED_CLIPBOARD = 0xc0a1e5ce | 0;
const CAPS = 1 << 24;
const REQUEST = 1 << 25;
const PEEK = 1 << 26;
const NOTIFY = 1 << 27;
const PROVIDE = 1 << 28;
const TEXT = 1;

function bytes(...parts: (number[] | Uint8Array)[]): Uint8Array {
  return new Uint8Array(parts.flatMap((part) => [...part]));
}
function u32(value: number): number[] {
  return [
    (value >>> 24) & 255,
    (value >>> 16) & 255,
    (value >>> 8) & 255,
    value & 255,
  ];
}
function u16(value: number): number[] {
  return [(value >>> 8) & 255, value & 255];
}

/** What Xvnc does with what reaches it, as far as the clipboard goes. */
class XvncShapedServer implements RfbChannel {
  binaryType: BinaryType = 'arraybuffer';
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  readyState = 1;
  readonly protocol = '';
  private readonly filter = createRfbClientFilter();
  private handshake = 0;
  extendedClipboard = false;

  send(data: ArrayBufferLike | ArrayBufferView) {
    const chunk = ArrayBuffer.isView(data)
      ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength).slice()
      : new Uint8Array(data).slice();
    for (const message of this.filter.push(chunk)) this.handle(message);
  }

  close() {
    this.readyState = 3;
  }

  /** Arrives later, as off a socket, never inside noVNC's own send. */
  push(data: Uint8Array) {
    const buffer = data.slice().buffer;
    setTimeout(() =>
      this.onmessage?.(new MessageEvent('message', { data: buffer }))
    );
  }

  start() {
    this.push(new TextEncoder().encode('RFB 003.008\n'));
  }

  private handle(message: Uint8Array) {
    if (this.handshake === 0) {
      this.handshake = 1;
      // One security type: None.
      this.push(bytes([1, 1]));
      return;
    }
    if (this.handshake === 1) {
      this.handshake = 2;
      this.push(bytes(u32(0)));
      return;
    }
    if (this.handshake === 2) {
      this.handshake = 3;
      // ServerInit: 64x32, 32bpp true colour, named "desk".
      this.push(
        bytes(
          u16(64),
          u16(32),
          [32, 24, 0, 1],
          u16(255),
          u16(255),
          u16(255),
          [16, 8, 0, 0, 0, 0],
          u32(4),
          new TextEncoder().encode('desk')
        )
      );
      return;
    }
    if (message[0] !== 2) return;
    const view = new DataView(
      message.buffer,
      message.byteOffset,
      message.byteLength
    );
    const encodings = Array.from({ length: view.getUint16(2) }, (_, index) =>
      view.getInt32(4 + index * 4)
    );
    this.extendedClipboard = encodings.includes(EXTENDED_CLIPBOARD);
    if (this.extendedClipboard) {
      // Xvnc announces its extended clipboard caps at once.
      this.push(
        this.extended(
          CAPS | REQUEST | PEEK | NOTIFY | PROVIDE | TEXT,
          u32(10 * 1024 * 1024)
        )
      );
    }
  }

  private extended(flags: number, payload: number[] | Uint8Array): Uint8Array {
    return bytes(
      [3, 0, 0, 0],
      u32(-(4 + payload.length) >>> 0),
      u32(flags >>> 0),
      payload
    );
  }

  /**
   * The guest's selection changed. With the extended clipboard, the client's
   * caps never arrive (the filter drops every ClientCutText the frame sends),
   * so Xvnc keeps the spec's default caps and sends the text unsolicited;
   * otherwise it is a plain ServerCutText.
   */
  selection(text: string) {
    if (this.extendedClipboard) {
      const utf8 = new TextEncoder().encode(`${text}\0`);
      const zlib = deflateSync(bytes(u32(utf8.length), utf8));
      this.push(this.extended(PROVIDE | TEXT, zlib));
      return;
    }
    const latin1 = Uint8Array.from(
      text,
      (character) => character.charCodeAt(0) & 255
    );
    this.push(bytes([3, 0, 0, 0], u32(latin1.length), latin1));
  }

  /** A Bell, then an empty FramebufferUpdate: what comes after must still parse. */
  more() {
    this.push(bytes([2]));
    this.push(bytes([0, 0], u16(0)));
  }
}

beforeAll(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    }
  );
  // jsdom has no canvas: noVNC only needs a 2D context that accepts calls.
  const context = new Proxy(
    {},
    {
      get: (_target, key) =>
        key === 'createImageData' || key === 'getImageData'
          ? (width = 1, height = 1) => ({
              data: new Uint8ClampedArray(width * height * 4),
              width,
              height,
            })
          : () => {},
    }
  );
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
    () => context as unknown as CanvasRenderingContext2D
  );
});
afterEach(() => {
  document.body.replaceChildren();
});

async function viewer() {
  const server = new XvncShapedServer();
  const screen = document.createElement('div');
  document.body.append(screen);
  const rfb = new RFB(screen, server, { shared: true });
  rfb.viewOnly = true;
  const failures: string[] = [];
  rfb.addEventListener('securityfailure', () => failures.push('security'));
  rfb.addEventListener('disconnect', () => failures.push('disconnected'));
  const connected = new Promise<void>((resolve) =>
    rfb.addEventListener('connect', () => resolve())
  );
  // noVNC attaches to the channel on its next tick.
  await new Promise((resolve) => setTimeout(resolve, 0));
  server.start();
  await connected;
  return { server, rfb, failures };
}

describe('noVNC with an Xvnc-shaped clipboard', () => {
  it.each([
    ['100 KB', 100 * 1024],
    ['2 MB', 2 * 1024 * 1024],
  ])(
    'keeps the stream in step when the guest selects %s',
    async (_size, length) => {
      const { server, rfb, failures } = await viewer();

      server.selection('a'.repeat(length));
      server.more();
      await new Promise((resolve) => setTimeout(resolve, 20));

      expect(failures).toEqual([]);
      rfb.disconnect();
    }
  );

  it("isn't offered the extended clipboard, which view-only noVNC can't skip", async () => {
    const { server, rfb } = await viewer();
    expect(server.extendedClipboard).toBe(false);
    rfb.disconnect();
  });
});
