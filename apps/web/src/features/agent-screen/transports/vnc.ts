import { Telemetry } from '@macro-inc/observability';
import {
  parseServerMessage,
  reportVisibility,
  sendControl,
  waitForOpen,
} from './control';
import { encodeInput } from './rfb-input';
import type {
  ScreenEndReason,
  ScreenSession,
  ScreenSessionHandlers,
  ScreenTicketGrant,
  ScreenTransport,
} from './types';
import { createRfbClientFilter } from './vnc-frame/client-filter';
import { loadVncFrameCode } from './vnc-frame/frame-code';
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
 * to the frame over a MessagePort, what noVNC sends comes back the same way
 * through a filter that lets only a view-only client's messages reach the
 * server, and text frames (JSON control) never reach the frame.
 *
 * noVNC runs view only. Input arrives already mapped to guest pixels through
 * `sendInput`, which writes RFB KeyEvent / PointerEvent / ClientCutText
 * messages onto the socket between noVNC's own whole messages; the harness
 * drops them unless this viewer holds the driver lease.
 */

/** Nothing loads from anywhere; the one inline module script is the bundle below. */
export const VNC_FRAME_CSP =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:";

/**
 * The frame's document. `</script`, `<script` and `<!--` inside the bundle
 * (in any case) would end or change the inline script, so their `<` is
 * written as `\x3c`, which means the same inside the JavaScript strings and
 * regexes where such text can occur.
 */
export function vncFrameDocument(code: string): string {
  const inline = code.replace(/<(\/?script|!--)/gi, '\\x3c$1');
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${VNC_FRAME_CSP}"><style>html,body,#screen{margin:0;width:100%;height:100%;overflow:hidden;background:transparent}</style></head><body><div id="screen"></div><script type="module">${inline}</script></body></html>`;
}

/** A loupe snapshot the frame hasn't answered by then is given up on. */
const SNAPSHOT_TIMEOUT_MS = 500;

/** How long the frame gets to load its script and ask for a port. */
const FRAME_READY_TIMEOUT_MS = 10_000;

/** The largest framebuffer side the frame may report (RFB allows 65535). */
const MAX_FRAME_SIDE = 16_384;

function frameSide(value: number): number | undefined {
  return Number.isInteger(value) && value > 0 && value <= MAX_FRAME_SIDE
    ? value
    : undefined;
}

function abortError(): DOMException {
  return new DOMException('The screen connection was abandoned', 'AbortError');
}

/**
 * Mounts the sandboxed frame and resolves with its port once it asks for one;
 * rejects (and removes the frame) when it never does, e.g. a CSP that blocks
 * its inline script, or when `signal` aborts first.
 */
function mountFrame(
  element: HTMLElement,
  code: string,
  signal: AbortSignal
): Promise<{
  frame: HTMLIFrameElement;
  port: MessagePort;
}> {
  const frame = document.createElement('iframe');
  frame.setAttribute('sandbox', 'allow-scripts');
  // No powerful features, and no referrer, for whatever runs in there.
  frame.setAttribute('allow', '');
  frame.setAttribute('referrerpolicy', 'no-referrer');
  frame.setAttribute('aria-hidden', 'true');
  frame.tabIndex = -1;
  frame.style.cssText =
    'display:block;width:100%;height:100%;border:0;pointer-events:none;background:transparent';

  return new Promise((resolve, reject) => {
    const stop = (error: Error) => {
      clearTimeout(timeout);
      window.removeEventListener('message', onReady);
      signal.removeEventListener('abort', onAbort);
      frame.remove();
      reject(error);
    };
    const onAbort = () => stop(abortError());
    const timeout = setTimeout(
      () => stop(new Error('The vnc frame did not start')),
      FRAME_READY_TIMEOUT_MS
    );
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
      signal.removeEventListener('abort', onAbort);
      const channel = new MessageChannel();
      frame.contentWindow?.postMessage(null, '*', [channel.port2]);
      resolve({ frame, port: channel.port1 });
    };
    window.addEventListener('message', onReady);
    signal.addEventListener('abort', onAbort, { once: true });

    frame.srcdoc = vncFrameDocument(code);
    element.append(frame);
  });
}

async function connectVnc(
  element: HTMLElement,
  ticket: ScreenTicketGrant,
  handlers: ScreenSessionHandlers,
  signal: AbortSignal
): Promise<ScreenSession> {
  if (signal.aborted) throw abortError();
  const socket = new WebSocket(ticket.socketUrl);
  reportVisibility(socket);
  socket.binaryType = 'arraybuffer';
  let endReason: ScreenEndReason | undefined;
  let closedByViewer = false;
  let rfbReady = false;
  const filter = createRfbClientFilter();
  // One end per connection: the socket's close and a later failure (a
  // queued client message the filter rejects) both report one.
  let endReported = false;
  const reportEnd = (
    reason: Parameters<ScreenSessionHandlers['onEnded']>[0]
  ) => {
    if (endReported) return;
    endReported = true;
    handlers.onEnded(reason);
  };

  // Server bytes that arrive before the frame is listening wait here.
  let port: MessagePort | undefined;
  let frame: HTMLIFrameElement | undefined;
  const pending: ArrayBuffer[] = [];
  const toFrame = (message: ToVncFrame, transfer: Transferable[] = []) =>
    port?.postMessage(message, transfer);
  const snapshots = createPendingReplies<ImageBitmap>(SNAPSHOT_TIMEOUT_MS);

  /** Ends everything this connection opened; safe to call more than once. */
  const close = () => {
    closedByViewer = true;
    rfbReady = false;
    toFrame({ type: 'close' });
    snapshots.settleAll();
    port?.close();
    frame?.remove();
    socket.close();
    if (filter.dropped() > 0) {
      Telemetry.warn('computer.screen.frame_messages_dropped', {
        'screen.dropped': filter.dropped(),
      });
    }
  };
  // Ends the connect in flight: abandoned by the viewer (pane closed, Retry,
  // waking), or the socket closed before the handshake finished. Closes now,
  // rather than leave a socket streaming into a removed frame or a connect
  // waiting forever.
  const attempt = new AbortController();
  signal.addEventListener('abort', () => attempt.abort(), { once: true });
  attempt.signal.addEventListener('abort', close, { once: true });

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
    if (!closedByViewer) reportEnd(endReason ?? 'connectionLost');
    // Before the handshake: the connect ends here too (the end is reported
    // once, above; the session ignores the connect's rejection after it).
    if (!rfbReady) attempt.abort();
  });

  let code: string;
  try {
    [code] = await Promise.all([loadVncFrameCode(), waitForOpen(socket)]);
    if (attempt.signal.aborted) throw abortError();
    const mounted = await mountFrame(element, code, attempt.signal);
    port = mounted.port;
    frame = mounted.frame;
  } catch (error) {
    close();
    throw error;
  }
  const framePort = port;

  const connected = new Promise<void>((resolve, reject) => {
    attempt.signal.addEventListener('abort', () => reject(abortError()), {
      once: true,
    });
    framePort.onmessage = (event: MessageEvent<FromVncFrame>) => {
      const message = event.data;
      if (message.type === 'send') {
        let messages: Uint8Array<ArrayBuffer>[];
        try {
          messages = filter.push(new Uint8Array(message.data));
        } catch (error) {
          // A stream the filter can't frame can't be trusted past this point.
          Telemetry.error(error, { 'screen.transport': 'vnc' });
          reject(error);
          // `close` forgets readiness: an established session reports its
          // end, one still handshaking has the rejection.
          const established = rfbReady;
          close();
          if (established) reportEnd('error');
          return;
        }
        if (socket.readyState !== WebSocket.OPEN) return;
        for (const bytes of messages) socket.send(bytes);
      } else if (message.type === 'connected') {
        resolve();
      } else if (message.type === 'disconnected') {
        // Before the handshake finished this is a failed connect, reported
        // by the rejection; after it, the socket's close reports the end.
        reject(new Error('RFB handshake failed'));
        if (!rfbReady) close();
        else socket.close();
      } else if (message.type === 'size') {
        const width = frameSide(message.width);
        const height = frameSide(message.height);
        if (width && height) handlers.onFrameSize({ width, height });
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
    handBack: (note, leaseId) =>
      sendControl(socket, { type: 'handBack', note, leaseId }),
    stop: () => sendControl(socket, { type: 'stop' }),
    close,
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
