import RFB, { type RfbChannel } from '@novnc/novnc';
import type { FromVncFrame, ToVncFrame } from './protocol';
import { VNC_FRAME_READY } from './protocol';
import { snapshotCopy } from './snapshot-region';

/**
 * Runs inside the sandboxed srcdoc frame (opaque origin, no network, CSP
 * `default-src 'none'`), bundled into one inline module script. The guest
 * controls every byte noVNC parses here, so a decoder bug can reach only this
 * frame, never the app's origin, cookies or DOM.
 *
 * The parent hands over a MessagePort and relays the socket's binary frames;
 * this frame answers with what noVNC sends, the framebuffer size, and loupe
 * snapshots.
 */

const OPEN = 1;
const CLOSED = 3;

/** A WebSocket-shaped channel for noVNC whose wire is the parent's port. */
class PortChannel implements RfbChannel {
  binaryType: BinaryType = 'arraybuffer';
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  private state = OPEN;

  constructor(private readonly port: MessagePort) {}

  get protocol(): string {
    return '';
  }

  get readyState(): number {
    return this.state;
  }

  send(data: ArrayBufferLike | ArrayBufferView) {
    // noVNC sends views into its reused send buffer: copy before transferring.
    const bytes =
      data instanceof ArrayBuffer
        ? data.slice(0)
        : ArrayBuffer.isView(data)
          ? new Uint8Array(
              data.buffer,
              data.byteOffset,
              data.byteLength
            ).slice().buffer
          : new Uint8Array(data).slice().buffer;
    post(this.port, { type: 'send', data: bytes }, [bytes]);
  }

  close() {
    if (this.state === CLOSED) return;
    this.state = CLOSED;
    this.onclose?.(new CloseEvent('close', { wasClean: true }));
  }

  receive(data: ArrayBuffer) {
    this.onmessage?.(new MessageEvent('message', { data }));
  }
}

function post(
  port: MessagePort,
  message: FromVncFrame,
  transfer: Transferable[] = []
) {
  port.postMessage(message, transfer);
}

/**
 * A copy of a guest region at the requested size, transparent where it runs
 * off the canvas. Only the overlap is read (`snapshotCopy`): WebKit rejects a
 * source rect outside the image.
 */
async function copyRegion(
  source: HTMLCanvasElement | null,
  rect: { x: number; y: number; width: number; height: number }
): Promise<ImageBitmap | null> {
  if (!source) return null;
  const copy = snapshotCopy(source, rect);
  if (!copy) return null;
  const target = document.createElement('canvas');
  target.width = rect.width;
  target.height = rect.height;
  const context = target.getContext('2d');
  if (!context) return null;
  const { x, y, width, height } = copy.source;
  context.drawImage(
    source,
    x,
    y,
    width,
    height,
    copy.offsetX,
    copy.offsetY,
    width,
    height
  );
  return createImageBitmap(target);
}

/** A copy of the picture at its native size, or nothing before the first. */
function stillOf(source: HTMLCanvasElement | null): HTMLCanvasElement | null {
  if (!source || source.width === 0 || source.height === 0) return null;
  const still = document.createElement('canvas');
  still.width = source.width;
  still.height = source.height;
  still.style.display = 'block';
  still.setAttribute('data-last-picture', '');
  still.getContext('2d')?.drawImage(source, 0, 0);
  return still;
}

function start(port: MessagePort) {
  const screen = document.getElementById('screen');
  if (!screen) return;

  const channel = new PortChannel(port);
  const rfb = new RFB(screen, channel, { shared: true });
  rfb.viewOnly = true;
  rfb.focusOnClick = false;
  rfb.scaleViewport = false;
  rfb.clipViewport = false;
  rfb.resizeSession = false;
  rfb.showDotCursor = false;

  const canvas = () => screen.querySelector('canvas');

  // noVNC sizes its canvas to the framebuffer (before `connect`, and on every
  // desktop resize) and has no event for it.
  const watchSize = (target: HTMLCanvasElement) => {
    const report = () => {
      if (target.width > 0 && target.height > 0) {
        post(port, {
          type: 'size',
          width: target.width,
          height: target.height,
        });
      }
    };
    new MutationObserver(report).observe(target, {
      attributes: true,
      attributeFilter: ['width', 'height'],
    });
    report();
  };

  rfb.addEventListener('connect', () => {
    const target = canvas();
    if (target) watchSize(target);
    post(port, { type: 'connected' });
  });
  rfb.addEventListener('disconnect', (event) => {
    const clean = event instanceof CustomEvent && event.detail?.clean === true;
    post(port, { type: 'disconnected', clean });
  });

  port.onmessage = async (event: MessageEvent<ToVncFrame>) => {
    const message = event.data;
    if (message.type === 'received') {
      channel.receive(message.data);
    } else if (message.type === 'close') {
      // noVNC takes its canvas away on disconnect: keep a still of the last
      // picture in its place, which a reconnect shows until it is live.
      const still = stillOf(canvas());
      rfb.disconnect();
      channel.close();
      if (still) screen.append(still);
    } else if (message.type === 'snapshot') {
      // Always answer, or the loupe waits for the timeout.
      const bitmap = await copyRegion(canvas(), message).catch(() => null);
      post(
        port,
        { type: 'snapshot', id: message.id, bitmap },
        bitmap ? [bitmap] : []
      );
    }
  };
}

// The parent answers the first `ready` with the port; later messages on
// `window` are ignored, so nothing else can hand this frame a second port.
let started = false;
addEventListener('message', (event: MessageEvent) => {
  const [port] = event.ports;
  if (started || event.source !== parent || !port) return;
  started = true;
  start(port);
});
parent.postMessage({ type: VNC_FRAME_READY }, '*');
