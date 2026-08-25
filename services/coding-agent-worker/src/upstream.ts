import type { AcpMessage } from './protocol/generated';
import { connect, type Socket } from './socket';

/** One session-scoped `Socket` to the agent proxy. This worker plays the
 * Agent Runtime role, so it sends `ToServerMessage` and receives
 * `ToRuntimeMessage` (both carried by the socket).
 *
 * No reconnect: sessions are ephemeral, so a dropped socket ends the session
 * rather than resuming it. */
export class UpstreamLink {
  private readonly socket: Socket;
  private open = false;
  private currentEvent: string | null = null;
  private handler: ((frame: AcpMessage) => void) | null = null;
  /** ACP frames sent before the socket opened, flushed on open. */
  private readonly outgoing: AcpMessage[] = [];
  /** ACP frames received before `onAcp` was set, flushed when it is. */
  private readonly incoming: AcpMessage[] = [];

  constructor(
    url: string,
    private readonly sessionId: string,
    dial: (url: string) => Socket = connect
  ) {
    const endpoint = new URL(url);
    endpoint.searchParams.set('id', sessionId);
    this.socket = dial(endpoint.toString());
    this.socket.onOpen = () => {
      console.log(`[upstream ${this.sessionId}] connected`);
      this.open = true;
      if (this.currentEvent)
        this.socket.send({ type: 'event', event: this.currentEvent });
      for (const frame of this.outgoing.splice(0))
        this.socket.send({ ...frame, type: 'acp' });
    };
    this.socket.onMessage = (message) => {
      const { type: _type, ...frame } = message;
      console.log(`[upstream ${this.sessionId}] <- acp`, frame);
      if (this.handler) this.handler(frame);
      else this.incoming.push(frame);
    };
  }

  /** Handler for ACP frames relayed from the upstream. Frames that arrive
   * before this is set (e.g. a proxy-initiated `session/new` racing ahead of
   * the sandbox connection) are queued and delivered the moment it is. */
  set onAcp(handler: (frame: AcpMessage) => void) {
    this.handler = handler;
    for (const frame of this.incoming.splice(0)) handler(frame);
  }

  /** Send an ACP frame to the upstream. */
  acp(frame: AcpMessage) {
    console.log(`[upstream ${this.sessionId}] -> acp`, frame);
    if (this.open) this.socket.send({ ...frame, type: 'acp' });
    else this.outgoing.push(frame);
  }

  /** Report a lifecycle event to the upstream (e.g. `booting`, `acp_ready`,
   * `shutting_down`). Only the latest event is replayed when the socket
   * opens. */
  status(event: string) {
    console.log(`[upstream ${this.sessionId}] status -> ${event}`);
    this.currentEvent = event;
    if (this.open) this.socket.send({ type: 'event', event });
  }

  close() {
    this.open = false;
    this.socket.close();
  }
}
