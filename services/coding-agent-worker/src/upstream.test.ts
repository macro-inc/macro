import { expect, test } from 'bun:test';
import type { ToRuntimeMessage, ToServerMessage } from './protocol/generated';
import type { Socket } from './socket';
import { UpstreamLink } from './upstream';

class MockSocket implements Socket {
  onOpen: () => void = () => {};
  onMessage: (message: ToRuntimeMessage) => void = () => {};
  readonly sent: ToServerMessage[] = [];
  closed = false;

  constructor(readonly url: string) {}

  send(message: ToServerMessage) {
    this.sent.push(message);
  }

  close() {
    this.closed = true;
  }
}

function setup() {
  let socket: MockSocket | undefined;
  const link = new UpstreamLink(
    'ws://localhost:4001/ws?existing=true',
    'session 1',
    (url) => {
      socket = new MockSocket(url);
      return socket;
    }
  );
  return { link, socket: socket! };
}

test('uses the query session id and agent_runtime_protocol tagged messages', () => {
  const { link, socket } = setup();
  expect(new URL(socket.url).searchParams.get('id')).toBe('session 1');
  expect(new URL(socket.url).searchParams.get('existing')).toBe('true');

  link.status('booting');
  socket.onOpen();
  expect(socket.sent[0]).toEqual({ type: 'event', event: 'booting' });

  link.acp({ jsonrpc: '2.0', method: 'session/update' });
  expect(socket.sent[1]).toEqual({
    type: 'acp',
    jsonrpc: '2.0',
    method: 'session/update',
  });

  let received: unknown;
  link.onAcp = (message) => {
    received = message;
  };
  socket.onMessage({ type: 'acp', jsonrpc: '2.0', id: 1, result: {} });
  expect(received).toEqual({ jsonrpc: '2.0', id: 1, result: {} });
  link.close();
  expect(socket.closed).toBe(true);
});

test('ACP frames received before onAcp is set are queued and flushed once it is', () => {
  const { link, socket } = setup();
  socket.onOpen();

  // Arrives before any caller has wired up a real handler (e.g. the proxy's
  // session/new bootstrap racing ahead of the runtime's own downstream
  // connection) - must not be silently dropped.
  socket.onMessage({
    type: 'acp',
    jsonrpc: '2.0',
    id: 'agent_proxy:session/new',
    result: {},
  });

  const received: unknown[] = [];
  link.onAcp = (message) => {
    received.push(message);
  };
  expect(received).toEqual([
    { jsonrpc: '2.0', id: 'agent_proxy:session/new', result: {} },
  ]);

  // Once attached, later frames deliver immediately - no re-queueing.
  socket.onMessage({ type: 'acp', jsonrpc: '2.0', id: 'live', result: {} });
  expect(received).toEqual([
    { jsonrpc: '2.0', id: 'agent_proxy:session/new', result: {} },
    { jsonrpc: '2.0', id: 'live', result: {} },
  ]);
  link.close();
});

test('ACP frames sent before the socket opens are queued and flushed on open', () => {
  const { link, socket } = setup();
  link.status('ready');
  link.acp({ jsonrpc: '2.0', id: 'early', method: 'session/prompt' });
  expect(socket.sent).toEqual([]);

  socket.onOpen();
  expect(socket.sent).toEqual([
    { type: 'event', event: 'ready' },
    { type: 'acp', jsonrpc: '2.0', id: 'early', method: 'session/prompt' },
  ]);
  link.close();
});
