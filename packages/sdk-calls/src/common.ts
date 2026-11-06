import { reportError, startSpan, withSpan } from './telemetry';

export type JoinOptions = {
  onOtherCall?: 'fail' | 'switch';
  replace?: boolean;
  name?: string;
};

/** The public SDK supplies this shape; no runtime import is needed. */
export type CallConnection = {
  readonly call: { readonly id: string };
  readonly url: string;
  readonly token: string;
  readonly identity: string;
  readonly roomName: string;
  readonly started: boolean;
  leave(): Promise<{ callEnded: boolean }>;
};

export type CallTarget =
  | { join(options?: JoinOptions): Promise<CallConnection> }
  | { startCall(options?: JoinOptions): Promise<CallConnection> };

const callIds = new WeakMap<object, string>();

export function callIdForRoom(room: object): string | undefined {
  return callIds.get(room);
}

export async function connectRoomWith<Room extends object>(
  target: CallTarget,
  options: JoinOptions | undefined,
  room: Room,
  connect: (room: Room, connection: CallConnection) => Promise<void>,
  onDisconnect: (room: Room, callback: (reason?: unknown) => void) => void,
): Promise<{ room: Room; connection: CallConnection }> {
  return withSpan('call.sdk.connect', async (span) => {
    let connection: CallConnection | undefined;
    let leavePromise: Promise<void> | undefined;

    const leaveOnce = () => {
      if (!connection) return Promise.resolve();
      return leavePromise ??= connection.leave().then(() => {});
    };

    try {
      connection =
        'startCall' in target
          ? await target.startCall(options)
          : await target.join(options);
      span.setAttribute('call.id', connection.call.id);
      callIds.set(room, connection.call.id);
      onDisconnect(room, (reason) => {
        const disconnected = startSpan('call.sdk.disconnected');
        disconnected.setAttribute('call.id', connection?.call.id ?? '');
        disconnected.setAttribute('call.sdk.reason', String(reason ?? 'unknown'));
        disconnected.end();
        leaveOnce().catch((error: unknown) => {
          reportError('call.sdk.disconnected', error, connection?.call.id);
        });
      });
      await connect(room, connection);
      span.setAttribute('call.sdk.outcome', 'connected');
      return { room, connection };
    } catch (error) {
      span.setAttribute('call.sdk.outcome', 'failed');
      await leaveOnce().catch((leaveError: unknown) => {
        reportError('call.sdk.disconnected', leaveError, connection?.call.id);
      });
      throw error;
    }
  });
}
