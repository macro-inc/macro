import { parseServerMessage, sendControl, waitForOpen } from './control';
import { encodeInput, withoutCursorEncodings } from './rfb-input';
import type {
  ScreenEndReason,
  ScreenSession,
  ScreenSessionHandlers,
  ScreenTicketGrant,
  ScreenTransport,
} from './types';
import { createPendingReplies } from './vnc-frame/pending-replies';
import {
  type FromVncFrame,
  type ToVncFrame,
  VNC_FRAME_READY,
} from './vnc-frame/protocol';

/**
 * The vnc transport: noVNC decodes the guest's RFB stream, relayed byte for
 * byte by the harness over the screen socket.
 *
 * The guest controls every byte noVNC parses, so noVNC runs in a sandboxed
 * srcdoc frame (`sandbox="allow-scripts"`, never `allow-same-origin`: an
 * opaque origin with no access to the app's cookies, storage or DOM) whose CSP
 * allows no network at all. The transport keeps the socket: binary frames go
 * to the frame over a MessagePort, what noVNC sends comes back the same way,
 * and text frames (JSON control) never reach the frame.
 *
 * noVNC runs view only. Input arrives already mapped to guest pixels through
 * `sendInput`, which writes RFB KeyEvent / PointerEvent / ClientCutText
 * messages onto the socket between noVNC's own whole messages; the harness
 * drops them unless this viewer holds the driver lease.
 */

/** Nothing loads from anywhere; the one inline module script is the bundle below. */
const FRAME_CSP =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:";

function frameDocument(code: string): string {
  // `</script` inside the bundle would end the inline script early.
  const inline = code.replaceAll('</script', '<\\/script');
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${FRAME_CSP}"><style>html,body,#screen{margin:0;width:100%;height:100%;overflow:hidden;background:transparent}</style></head><body><div id="screen"></div><script type="module">${inline}</script></body></html>`;
}

/** A loupe snapshot the frame hasn't answered by then is given up on. */
const SNAPSHOT_TIMEOUT_MS = 500;

/** How long the frame gets to load its script and ask for a port. */
const FRAME_READY_TIMEOUT_MS = 10_000;

/**
 * Mounts the sandboxed frame and resolves with its port once it asks for one;
 * rejects (and removes the frame) when it never does, e.g. a CSP that blocks
 * its inline script.
 */
function mountFrame(
  element: HTMLElement,
  code: string
): Promise<{
  frame: HTMLIFrameElement;
  port: MessagePort;
}> {
  const frame = document.createElement('iframe');
  frame.setAttribute('sandbox', 'allow-scripts');
  frame.setAttribute('aria-hidden', 'true');
  frame.tabIndex = -1;
  frame.style.cssText =
    'display:block;width:100%;height:100%;border:0;pointer-events:none;background:transparent';

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      window.removeEventListener('message', onReady);
      frame.remove();
      reject(new Error('The vnc frame did not start'));
    }, FRAME_READY_TIMEOUT_MS);
    const onReady = (event: MessageEvent) => {
      // Only this frame's own window, and only its first ready, gets a port.
      if (event.source !== frame.contentWindow) return;
      const data: unknown = event.data;
      const ready =
        typeof data === 'object' &&
        data !== null &&
        'type' in data &&
        data.type === VNC_FRAME_READY;
      if (!ready) return;

      clearTimeout(timeout);
      window.removeEventListener('message', onReady);
      const channel = new MessageChannel();
      frame.contentWindow?.postMessage(null, '*', [channel.port2]);
      resolve({ frame, port: channel.port1 });
    };
    window.addEventListener('message', onReady);

    frame.srcdoc = frameDocument(code);
    element.append(frame);
  });
}

async function connectVnc(
  element: HTMLElement,
  ticket: ScreenTicketGrant,
  handlers: ScreenSessionHandlers
): Promise<ScreenSession> {
  const socket = new WebSocket(ticket.socketUrl);
  socket.binaryType = 'arraybuffer';
  let endReason: ScreenEndReason | undefined;
  let closedByViewer = false;
  let rfbReady = false;

  // Server bytes that arrive before the frame is listening wait here.
  let port: MessagePort | undefined;
  const pending: ArrayBuffer[] = [];
  const toFrame = (message: ToVncFrame, transfer: Transferable[] = []) =>
    port?.postMessage(message, transfer);

  socket.addEventListener('message', (event: MessageEvent) => {
    if (typeof event.data === 'string') {
      const message = parseServerMessage(event.data);
      if (message?.type === 'state') {
        const { type: _type, ...state } = message;
        handlers.onState(state);
      } else if (message?.type === 'error') {
        handlers.onError({ code: message.code, message: message.message });
      } else if (message?.type === 'ended') {
        endReason = message.reason;
      }
      return;
    }
    if (!(event.data instanceof ArrayBuffer)) return;

    if (port) toFrame({ type: 'received', data: event.data }, [event.data]);
    else pending.push(event.data);
  });

  socket.addEventListener('close', () => {
    toFrame({ type: 'close' });
    if (closedByViewer) return;
    handlers.onEnded(endReason ?? 'connectionLost');
  });

  // The bundled noVNC is a sizeable string; load it only when a screen opens.
  const [{ default: code }] = await Promise.all([
    import(
      'virtual:sandboxed-frame/features/agent-screen/transports/vnc-frame/frame-main'
    ),
    waitForOpen(socket),
  ]);
  const mounted = await mountFrame(element, code).catch((error: unknown) => {
    closedByViewer = true;
    socket.close();
    throw error;
  });
  port = mounted.port;

  const snapshots = createPendingReplies<ImageBitmap>(SNAPSHOT_TIMEOUT_MS);

  const connected = new Promise<void>((resolve, reject) => {
    mounted.port.onmessage = (event: MessageEvent<FromVncFrame>) => {
      const message = event.data;
      if (message.type === 'send') {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(withoutCursorEncodings(new Uint8Array(message.data)));
        }
      } else if (message.type === 'connected') {
        resolve();
      } else if (message.type === 'disconnected') {
        // Before the handshake finished this is a failed connect, reported
        // by the rejection; after it, the socket's close reports the end.
        reject(new Error('RFB handshake failed'));
        if (!rfbReady) {
          closedByViewer = true;
          mounted.port.close();
          mounted.frame.remove();
        }
        socket.close();
      } else if (message.type === 'size') {
        handlers.onFrameSize({ width: message.width, height: message.height });
      } else if (message.type === 'snapshot') {
        const bitmap = message.bitmap ?? undefined;
        // Too late: the loupe moved on; free the pixels.
        if (!snapshots.settle(message.id, bitmap)) bitmap?.close();
      }
    };
  });

  for (const data of pending.splice(0)) {
    toFrame({ type: 'received', data }, [data]);
  }

  await connected;
  rfbReady = true;

  return {
    sendInput(event) {
      if (!rfbReady || socket.readyState !== WebSocket.OPEN) return;
      for (const message of encodeInput(event)) socket.send(message);
    },
    takeOver: () => sendControl(socket, { type: 'takeOver' }),
    handBack: (note) => sendControl(socket, { type: 'handBack', note }),
    stop: () => sendControl(socket, { type: 'stop' }),
    close() {
      closedByViewer = true;
      rfbReady = false;
      toFrame({ type: 'close' });
      snapshots.settleAll();
      mounted.port.close();
      mounted.frame.remove();
      socket.close();
    },
    snapshot(rect) {
      return snapshots.request((id) =>
        toFrame({ type: 'snapshot', id, ...rect })
      );
    },
  };
}

export const VNC_TRANSPORT: ScreenTransport = {
  kind: 'vnc',
  connect: connectVnc,
};
