import { describe, expect, mock, test } from 'bun:test';

mock.module('@macro-inc/observability', () => ({
  Telemetry: {
    span: (_name: string, action?: (span: object) => Promise<unknown>) => {
      const span = {
        setAttr: () => {},
        error: () => {},
        end: () => {},
      };
      return action ? action(span) : span;
    },
  },
}));

const { connectRoomWith } = await import('../src/common');

describe('connectRoomWith', () => {
  test('starts a channel, connects, and leaves once on repeated disconnects', async () => {
    const leave = mock(async () => ({ callEnded: false }));
    const connection = {
      call: { id: 'call-1' },
      url: 'wss://example.invalid',
      token: 'secret',
      identity: 'account-1',
      roomName: 'room-1',
      started: true,
      leave,
    };
    const startCall = mock(async () => connection);
    const connect = mock(async () => {});
    let disconnect = () => {};
    const room = {};

    const result = await connectRoomWith(
      { startCall },
      { onOtherCall: 'fail' },
      room,
      connect,
      (_room, callback) => { disconnect = callback; },
    );

    expect(result).toEqual({ room, connection });
    expect(startCall).toHaveBeenCalledWith({ onOtherCall: 'fail' });
    expect(connect).toHaveBeenCalledWith(room, connection);
    disconnect();
    disconnect();
    expect(leave).toHaveBeenCalledTimes(1);
  });

  test('leaves after a room connection failure', async () => {
    const leave = mock(async () => ({ callEnded: false }));
    const connection = {
      call: { id: 'call-2' },
      url: 'wss://example.invalid',
      token: 'secret',
      identity: 'account-2',
      roomName: 'room-2',
      started: false,
      leave,
    };
    const join = mock(async () => connection);

    await expect(connectRoomWith(
      { join },
      undefined,
      {},
      async () => { throw new Error('connect failed'); },
      () => {},
    )).rejects.toThrow('connect failed');
    expect(leave).toHaveBeenCalledTimes(1);
  });
});
