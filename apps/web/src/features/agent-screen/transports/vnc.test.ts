import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ScreenSessionHandlers } from './types';
import { VNC_TRANSPORT } from './vnc';
import type { FromVncFrame, ToVncFrame } from './vnc-frame/protocol';
import { VNC_FRAME_READY } from './vnc-frame/protocol';

// noVNC's bundle can't run in jsdom; the frame's side is played by the test.
vi.mock('./vnc-frame/frame-code', () => ({
  loadVncFrameCode: async () => 'const end = "</SCRIPT>"; const c = "<!--";',
}));

const TICKET = {
  socketUrl: 'wss://gateway.example/computers/harness-1/screen/ws?ticket=t',
  expiresAt: '',
};

class FakeSocket extends EventTarget {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 3;
  static last: FakeSocket | undefined;
  readyState = FakeSocket.CONNECTING;
  binaryType: BinaryType = 'blob';
  sent: (string | number[])[] = [];

  constructor(readonly url: string) {
    super();
    FakeSocket.last = this;
  }

  send(data: string | Uint8Array) {
    this.sent.push(typeof data === 'string' ? data : [...data]);
  }

  close() {
    if (this.readyState === FakeSocket.CLOSED) return;
    this.readyState = FakeSocket.CLOSED;
    this.dispatchEvent(new CloseEvent('close', { code: 1000 }));
  }

  open() {
    this.readyState = FakeSocket.OPEN;
    this.dispatchEvent(new Event('open'));
  }

  text(message: object) {
    this.dispatchEvent(
      new MessageEvent('message', { data: JSON.stringify(message) })
    );
  }

  binary(bytes: number[]) {
    const data = new Uint8Array(bytes).buffer;
    this.dispatchEvent(new MessageEvent('message', { data }));
  }
}

function handlers(): ScreenSessionHandlers {
  return {
    onState: () => {},
    onFrameSize: () => {},
    onError: () => {},
    onEnded: () => {},
  };
}

/** Waits for the transport to put its frame into `element`. */
async function frameIn(element: HTMLElement): Promise<HTMLIFrameElement> {
  return await vi.waitFor(() => {
    const frame = element.querySelector('iframe');
    if (!frame) throw new Error('no frame yet');
    return frame;
  });
}

/** Answers as the frame's script would, and returns its end of the port. */
async function frameAsksForPort(
  frame: HTMLIFrameElement
): Promise<MessagePort> {
  const contentWindow = frame.contentWindow;
  if (!contentWindow) throw new Error('frame has no window');
  const handed = vi
    .spyOn(contentWindow, 'postMessage')
    .mockImplementation(() => {});
  window.dispatchEvent(
    new MessageEvent('message', {
      data: { type: VNC_FRAME_READY },
      source: contentWindow,
    })
  );
  const [, , transfer] = handed.mock.calls[0] as unknown as [
    unknown,
    string,
    MessagePort[],
  ];
  return transfer[0];
}

beforeEach(() => {
  vi.stubGlobal('WebSocket', FakeSocket);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('VNC_TRANSPORT', () => {
  it('runs noVNC in a sandboxed, network-less frame and gives a port only to that frame', async () => {
    const element = document.createElement('div');
    document.body.append(element);
    const connecting = VNC_TRANSPORT.connect(
      element,
      TICKET,
      handlers(),
      new AbortController().signal
    );
    connecting.catch(() => {});
    FakeSocket.last?.open();
    const frame = await frameIn(element);

    expect(frame.getAttribute('sandbox')).toBe('allow-scripts');
    expect(frame.getAttribute('allow')).toBe('');
    expect(frame.getAttribute('referrerpolicy')).toBe('no-referrer');
    expect(frame.srcdoc).toContain(
      `content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:"`
    );
    // The bundle can't end the script early, in any case.
    expect(frame.srcdoc).not.toMatch(/<\/script>"|<!--/i);
    expect(frame.srcdoc).toContain('\\x3c/SCRIPT>');

    // A "ready" from any other window gets nothing.
    const contentWindow = frame.contentWindow;
    if (!contentWindow) throw new Error('frame has no window');
    const handed = vi
      .spyOn(contentWindow, 'postMessage')
      .mockImplementation(() => {});
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { type: VNC_FRAME_READY },
        source: window,
      })
    );
    expect(handed).not.toHaveBeenCalled();
    element.remove();
  });

  it('relays early server bytes in order and lets only a view-only client reach the server', async () => {
    const element = document.createElement('div');
    document.body.append(element);
    const connecting = VNC_TRANSPORT.connect(
      element,
      TICKET,
      handlers(),
      new AbortController().signal
    );
    const socket = FakeSocket.last;
    if (!socket) throw new Error('no socket');
    socket.open();
    // Server bytes before the frame is up wait for it.
    socket.binary([1, 2]);
    socket.binary([3]);
    const frame = await frameIn(element);
    const port = await frameAsksForPort(frame);

    const received: number[][] = [];
    port.onmessage = (event: MessageEvent<ToVncFrame>) => {
      if (event.data.type === 'received')
        received.push([...new Uint8Array(event.data.data)]);
    };
    const fromFrame = (message: FromVncFrame) => port.postMessage(message);
    const bytes = (...values: number[]) => new Uint8Array(values).buffer;
    fromFrame({
      type: 'send',
      data: new TextEncoder().encode('RFB 003.008\n').buffer,
    });
    fromFrame({ type: 'send', data: bytes(1, 1) });
    // A KeyEvent out of the frame: a decoder bug speaking for the driver.
    fromFrame({ type: 'send', data: bytes(4, 1, 0, 0, 0, 0, 0, 0x61) });
    fromFrame({ type: 'send', data: bytes(3, 0, 0, 0, 0, 0, 7, 128, 4, 56) });
    fromFrame({ type: 'connected' });
    await connecting;

    await vi.waitFor(() => expect(received).toEqual([[1, 2], [3]]));
    expect(socket.sent).toEqual([
      [...new TextEncoder().encode('RFB 003.008\n')],
      [1, 1],
      [3, 0, 0, 0, 0, 0, 7, 128, 4, 56],
    ]);
    port.close();
    element.remove();
  });

  it('closes the socket and removes the frame when abandoned before it connects', async () => {
    const element = document.createElement('div');
    document.body.append(element);
    const abandon = new AbortController();
    const connecting = VNC_TRANSPORT.connect(
      element,
      TICKET,
      handlers(),
      abandon.signal
    );
    const socket = FakeSocket.last;
    if (!socket) throw new Error('no socket');
    socket.open();
    const frame = await frameIn(element);
    const port = await frameAsksForPort(frame);

    // Waking: the frame is up, but RFB never says "connected".
    abandon.abort();

    await expect(connecting).rejects.toMatchObject({ name: 'AbortError' });
    expect(socket.readyState).toBe(FakeSocket.CLOSED);
    expect(element.querySelector('iframe')).toBeNull();
    port.close();
    element.remove();
  });

  it('reports a server end before the handshake once, and rejects the connect instead of hanging', async () => {
    const element = document.createElement('div');
    document.body.append(element);
    const ended: string[] = [];
    const connecting = VNC_TRANSPORT.connect(
      element,
      TICKET,
      { ...handlers(), onEnded: (reason) => ended.push(reason) },
      new AbortController().signal
    );
    const socket = FakeSocket.last;
    if (!socket) throw new Error('no socket');
    socket.open();
    const frame = await frameIn(element);
    const port = await frameAsksForPort(frame);

    // Waking failed: the computer is off. No RFB byte was ever sent.
    socket.text({ type: 'ended', reason: 'computerOff' });
    socket.close();

    await expect(connecting).rejects.toMatchObject({ name: 'AbortError' });
    expect(ended).toEqual(['computerOff']);
    expect(element.querySelector('iframe')).toBeNull();
    port.close();
    element.remove();
  });

  it('takes only sane framebuffer sizes from the frame', async () => {
    const element = document.createElement('div');
    document.body.append(element);
    const sizes: { width: number; height: number }[] = [];
    const connecting = VNC_TRANSPORT.connect(
      element,
      TICKET,
      { ...handlers(), onFrameSize: (size) => sizes.push(size) },
      new AbortController().signal
    );
    connecting.catch(() => {});
    FakeSocket.last?.open();
    const frame = await frameIn(element);
    const port = await frameAsksForPort(frame);

    const fromFrame = (message: FromVncFrame) => port.postMessage(message);
    fromFrame({ type: 'size', width: 0, height: 1080 });
    fromFrame({ type: 'size', width: 1e9, height: 1080 });
    fromFrame({ type: 'size', width: 19.5, height: 1080 });
    fromFrame({ type: 'size', width: 1920, height: 1080 });

    await vi.waitFor(() =>
      expect(sizes).toEqual([{ width: 1920, height: 1080 }])
    );
    port.close();
    element.remove();
  });
});
