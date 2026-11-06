import { Telemetry } from '@macro-inc/observability';

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
  return Telemetry.span('call.sdk.connect', async (span) => {
    let connection: CallConnection | undefined;
    let left = false;

    const leaveOnce = () => {
      if (left || !connection) return;
      left = true;
      void connection.leave().catch((error: unknown) => span.error(error));
    };

    try {
      connection =
        'startCall' in target
          ? await target.startCall(options)
          : await target.join(options);
      span.setAttr('call.id', connection.call.id);
      callIds.set(room, connection.call.id);
      onDisconnect(room, (reason) => {
        const disconnected = Telemetry.span('call.sdk.disconnected');
        disconnected.setAttr('call.id', connection?.call.id ?? '');
        disconnected.setAttr('call.sdk.reason', String(reason ?? 'unknown'));
        disconnected.end();
        leaveOnce();
      });
      await connect(room, connection);
      span.setAttr('call.sdk.outcome', 'connected');
      return { room, connection };
    } catch (error) {
      span.setAttr('call.sdk.outcome', 'failed');
      span.error(error);
      leaveOnce();
      throw error;
    }
  });
}
