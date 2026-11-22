import { Telemetry } from '@macro-inc/observability';
import { z } from 'zod';
import type { ScreenClientMessage, ScreenServerMessage } from './types';

/**
 * The screen socket's JSON control frames, shared by every transport: text
 * frames are control, binary frames are media.
 */

/**
 * A `state` field the viewer can do without: when the server sends something
 * else, log it and use `fallback`, so one bad field never drops the whole
 * frame (and with it who drives).
 */
function lenient<Schema extends z.ZodType>(
  field: string,
  schema: Schema,
  fallback: z.output<Schema>
) {
  return schema.catch((context) => {
    Telemetry.warn('computer.screen.state_field_invalid', {
      'screen.field': field,
      'error.message': context.error.issues[0]?.message ?? 'invalid',
    });
    return fallback;
  });
}

const serverMessageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('state'),
    driver: z
      .object({
        // A user without a profile name.
        name: lenient('driver.name', z.string().nullable(), null),
        isYou: z.boolean(),
      })
      .nullable(),
    agentHeld: lenient('agentHeld', z.boolean(), false),
    // Older harnesses don't send it: never waking.
    waking: lenient('waking', z.boolean().default(false), false),
    transport: z.enum(['vnc']),
    viewers: lenient('viewers', z.number(), 0),
    drivingHere: lenient('drivingHere', z.boolean().optional(), undefined),
    leaseId: lenient('leaseId', z.string().nullable().optional(), undefined),
  }),
  z.object({
    type: z.literal('error'),
    // A newer harness may send codes this client doesn't know: still an
    // error, so whatever waited on the answer (Take over) stops waiting.
    code: lenient(
      'error.code',
      z.enum([
        'driveNotAllowed',
        'driverBusy',
        'notDriver',
        'sourceUnavailable',
        'tunnelFailed',
        'tooManySockets',
        'badMessage',
        'inputFailed',
        'agentNotPausable',
        'takeOverUnavailable',
        // What any other code becomes.
        'unknown',
      ]),
      'unknown'
    ),
    message: lenient('error.message', z.string(), ''),
  }),
  z.object({
    type: z.literal('ended'),
    // An end this client doesn't know is still an end: retried like `error`.
    reason: lenient(
      'ended.reason',
      z.enum([
        'stopped',
        'computerOff',
        'accessRevoked',
        'shutdown',
        'idle',
        'error',
      ]),
      'error'
    ),
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
  if (parsed.success) return parsed.data;
  // Never silently: a dropped `state` leaves the viewer wrong about who drives.
  Telemetry.warn('computer.screen.server_message_dropped', {
    'screen.message_type':
      typeof json === 'object' && json !== null && 'type' in json
        ? String(json.type)
        : 'unknown',
    'error.message': parsed.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; '),
  });
  return undefined;
}

export function sendControl(socket: WebSocket, message: ScreenClientMessage) {
  if (socket.readyState !== WebSocket.OPEN) return;
  socket.send(JSON.stringify(message));
}

/** A shown tab says so this often; the server ends one that hasn't for 10 minutes. */
export const VISIBILITY_HEARTBEAT_MS = 60_000;

/**
 * Tells the server whether this tab is shown: once the socket opens, on every
 * change, and every minute while shown. The server ends a socket (`idle`) that
 * hasn't been shown or sent input for 10 minutes, or was hidden for two, so a
 * forgotten tab holds neither a socket nor a drive. Stops when the socket
 * closes.
 */
export function reportVisibility(socket: WebSocket) {
  const report = () =>
    sendControl(socket, {
      type: 'visibility',
      visible: document.visibilityState === 'visible',
    });
  const start = () => {
    report();
    const heartbeat = setInterval(() => {
      if (document.visibilityState === 'visible') report();
    }, VISIBILITY_HEARTBEAT_MS);
    document.addEventListener('visibilitychange', report);
    socket.addEventListener(
      'close',
      () => {
        clearInterval(heartbeat);
        document.removeEventListener('visibilitychange', report);
      },
      { once: true }
    );
  };
  if (socket.readyState === WebSocket.OPEN) start();
  else socket.addEventListener('open', start, { once: true });
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
