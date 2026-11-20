import type { RfbChannel } from '@novnc/novnc';
import { parseServerMessage, sendControl, waitForOpen } from './control';
import { encodeInput } from './rfb-input';
import type {
  ScreenEndReason,
  ScreenServerMessage,
  ScreenSession,
  ScreenSessionHandlers,
  ScreenStats,
  ScreenTicketGrant,
  ScreenTransport,
} from './types';

/**
 * The vnc transport: noVNC decodes the guest's RFB stream, relayed byte for
 * byte by the harness over the screen socket.
 *
 * noVNC never sees the socket itself. It gets a channel that passes binary
 * frames through and keeps text frames (JSON control) for us, and it runs view
 * only, so it never sends input or handles pointer events. Input arrives
 * already mapped to guest pixels through `sendInput`, which writes RFB
 * KeyEvent / PointerEvent / ClientCutText messages straight onto the socket,
 * between noVNC's own whole messages. The harness drops them unless this
 * viewer holds the driver lease.
 *
 * noVNC renders inline here. The guest controls the bytes it parses, so the
 * hardened setup runs it in a sandboxed iframe on a separate origin; that is a
 * follow-up before this leaves local testing.
 */

/** Passes binary frames to noVNC and diverts text frames to the control handler. */
class ControlSplittingChannel implements RfbChannel {
  binaryType: BinaryType = 'arraybuffer';
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  receivedBytes = 0;

  constructor(
    private readonly socket: WebSocket,
    onControl: (text: string) => void
  ) {
    socket.binaryType = 'arraybuffer';
    socket.addEventListener('open', (event) => this.onopen?.(event));
    socket.addEventListener('error', (event) => this.onerror?.(event));
    socket.addEventListener('close', (event) => this.onclose?.(event));
    socket.addEventListener('message', (event: MessageEvent) => {
      if (typeof event.data === 'string') {
        onControl(event.data);
        return;
      }
      if (event.data instanceof ArrayBuffer) {
        this.receivedBytes += event.data.byteLength;
      }
      this.onmessage?.(event);
    });
  }

  get protocol(): string {
    return this.socket.protocol;
  }

  get readyState(): number {
    return this.socket.readyState;
  }

  send(data: ArrayBufferLike | ArrayBufferView) {
    this.socket.send(data);
  }

  close() {
    this.socket.close();
  }
}

/** Bytes per second over the last few seconds, for the stats panel. */
function createRateMeter(read: () => number) {
  let lastBytes = read();
  let lastTime = performance.now();
  let kbps = 0;

  return () => {
    const now = performance.now();
    const elapsed = now - lastTime;
    if (elapsed >= 1000) {
      const bytes = read();
      kbps = ((bytes - lastBytes) * 8) / elapsed;
      lastBytes = bytes;
      lastTime = now;
    }
    return kbps;
  };
}

function watchFrameSize(
  element: HTMLElement,
  onSize: ScreenSessionHandlers['onFrameSize']
): () => void {
  // noVNC sizes its canvas to the remote framebuffer on connect and on every
  // desktop resize, and has no event for it.
  const canvas = element.querySelector('canvas');
  if (!canvas) return () => {};

  const report = () => {
    if (canvas.width > 0 && canvas.height > 0) {
      onSize({ width: canvas.width, height: canvas.height });
    }
  };
  const observer = new MutationObserver(report);
  observer.observe(canvas, {
    attributes: true,
    attributeFilter: ['width', 'height'],
  });
  report();

  return () => observer.disconnect();
}

async function connectVnc(
  element: HTMLElement,
  ticket: ScreenTicketGrant,
  handlers: ScreenSessionHandlers
): Promise<ScreenSession> {
  const socket = new WebSocket(ticket.socketUrl);
  let endReason: ScreenEndReason | undefined;
  let closedByViewer = false;
  let rfbReady = false;

  const onControl = (text: string) => {
    const message: ScreenServerMessage | undefined = parseServerMessage(text);
    if (!message) return;

    if (message.type === 'state') {
      const { type: _type, ...state } = message;
      handlers.onState(state);
    } else if (message.type === 'error') {
      handlers.onError({ code: message.code, message: message.message });
    } else if (message.type === 'ended') {
      endReason = message.reason;
    }
    // `signal` frames are WebRTC only.
  };

  const channel = new ControlSplittingChannel(socket, onControl);
  const kbps = createRateMeter(() => channel.receivedBytes);

  socket.addEventListener('close', () => {
    if (closedByViewer) return;
    handlers.onEnded(endReason ?? 'connectionLost');
  });

  // noVNC is a sizeable chunk; load it only when a screen opens.
  const [{ default: RFB }] = await Promise.all([
    import('@novnc/novnc'),
    waitForOpen(socket),
  ]);

  const rfb = new RFB(element, channel, { shared: true });
  rfb.viewOnly = true;
  rfb.focusOnClick = false;
  rfb.scaleViewport = false;
  rfb.clipViewport = false;
  rfb.resizeSession = false;
  rfb.showDotCursor = false;

  await new Promise<void>((resolve, reject) => {
    rfb.addEventListener('connect', () => resolve(), { once: true });
    rfb.addEventListener(
      'disconnect',
      () => reject(new Error('RFB handshake failed')),
      {
        once: true,
      }
    );
  });
  rfbReady = true;
  const stopWatchingSize = watchFrameSize(element, handlers.onFrameSize);

  return {
    sendInput(event) {
      if (!rfbReady || socket.readyState !== WebSocket.OPEN) return;
      for (const message of encodeInput(event)) socket.send(message);
    },
    takeOver: () => sendControl(socket, { type: 'takeOver' }),
    handBack: (note) => sendControl(socket, { type: 'handBack', note }),
    switchSurface: (surface) =>
      sendControl(socket, { type: 'switchSurface', surface }),
    stop: () => sendControl(socket, { type: 'stop' }),
    close() {
      closedByViewer = true;
      rfbReady = false;
      stopWatchingSize();
      rfb.disconnect();
      socket.close();
    },
    stats(): ScreenStats {
      return {
        fps: undefined,
        kbps: kbps(),
        rttMs: undefined,
        decodeMs: undefined,
      };
    },
  };
}

export const VNC_TRANSPORT: ScreenTransport = {
  kind: 'vnc',
  connect: connectVnc,
};
