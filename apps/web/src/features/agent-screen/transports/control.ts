import { z } from 'zod';
import type { ScreenClientMessage, ScreenServerMessage } from './types';

/**
 * The screen socket's JSON control frames, shared by every transport: text
 * frames are control, binary frames are media.
 */

const surfaceSchema = z.enum(['desktop', 'tab']);

const signalFields = {
  sdp: z
    .object({
      type: z.enum(['answer', 'offer', 'pranswer', 'rollback']),
      sdp: z.string().optional(),
    })
    .optional(),
  candidate: z
    .object({
      candidate: z.string().optional(),
      sdpMid: z.string().nullable().optional(),
      sdpMLineIndex: z.number().nullable().optional(),
      usernameFragment: z.string().nullable().optional(),
    })
    .optional(),
};

const serverMessageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('state'),
    driver: z.object({ userId: z.string(), name: z.string() }).nullable(),
    agentHeld: z.boolean(),
    surface: surfaceSchema,
    transport: z.enum(['vnc', 'stream', 'webrtc']),
    viewers: z.number(),
  }),
  z.object({ type: z.literal('signal'), ...signalFields }),
  z.object({
    type: z.literal('error'),
    code: z.enum([
      'driveNotAllowed',
      'driverBusy',
      'notDriver',
      'surfaceUnavailable',
      'badMessage',
      'inputFailed',
    ]),
    message: z.string(),
  }),
  z.object({
    type: z.literal('ended'),
    reason: z.enum([
      'stopped',
      'computerOff',
      'accessRevoked',
      'shutdown',
      'error',
    ]),
  }),
]);

/** Parses a text frame; `undefined` for anything this client doesn't understand. */
export function parseServerMessage(
  text: string
): ScreenServerMessage | undefined {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return undefined;
  }
  const parsed = serverMessageSchema.safeParse(json);
  return parsed.success ? parsed.data : undefined;
}

export function sendControl(socket: WebSocket, message: ScreenClientMessage) {
  if (socket.readyState !== WebSocket.OPEN) return;
  socket.send(JSON.stringify(message));
}

/** Waits for the socket to open; rejects if it closes or errors first. */
export function waitForOpen(socket: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    if (socket.readyState === WebSocket.OPEN) {
      resolve();
      return;
    }

    const cleanup = () => {
      socket.removeEventListener('open', onOpen);
      socket.removeEventListener('close', onClose);
    };
    const onOpen = () => {
      cleanup();
      resolve();
    };
    const onClose = (event: CloseEvent) => {
      cleanup();
      reject(new Error(`screen socket closed before opening (${event.code})`));
    };

    socket.addEventListener('open', onOpen);
    socket.addEventListener('close', onClose);
  });
}
