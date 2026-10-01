import * as A from '@automerge/automerge';
import { PresenceStore } from './presence';
import { FromPeer, FromRemote, InitializeFromSnapshotRequest } from '../bebop/generated/schema';
import { intoFrames, Reassembler } from '../../../packages/collaboration/src/websocket/platform/framing/frames';

export const encodeRevision = (heads: A.Heads): Uint8Array =>
  new TextEncoder().encode(JSON.stringify([...heads].sort()));

export type SessionOptions<T> = {
  url: string;
  token: () => string | Promise<string>;
  onChange?: (document: A.Doc<T>) => void;
  onError?: (error: Error) => void;
  onPresence?: (peers: Record<string, unknown>) => void;
};

/** Native Automerge peer for document or surface connect URLs. Unacknowledged
 * deltas survive disconnection in memory and are retried after the next handshake.
 * Applications must persist their snapshot and pending deltas for process recovery.
 */
export class AutomergeSession<T> {
  private document = A.init<T>();
  private socket?: WebSocket;
  private pending = new Map<string, Uint8Array>();
  private initialized = false;
  private presence = new PresenceStore(10_000);
  private connecting = false;
  private ready = false;
  private generation = 0;
  private disposed = false;
  readonly peerId = BigInt(`0x${A.getActorId(this.document).slice(0, 16)}`);

  constructor(private readonly options: SessionOptions<T>) {}
  get doc(): A.Doc<T> { return this.document; }
  get connected(): boolean { return this.ready; }
  get pendingUpdates(): number { return this.pending.size; }

  async connect(): Promise<void> {
    if (this.disposed) throw new Error('Session is disposed');
    if (this.connecting || this.ready) throw new Error('Session is already connecting or connected');
    this.connecting = true;
    const generation = ++this.generation;
    try {
      const url = new URL(this.options.url);
      if (url.protocol === 'https:') url.protocol = 'wss:';
      else if (url.protocol === 'http:') url.protocol = 'ws:';
      else if (url.protocol !== 'ws:' && url.protocol !== 'wss:') throw new Error('Unsupported sync URL protocol');
      const token = await this.options.token();
      if (this.disposed || this.generation !== generation) throw new Error('Connection cancelled');
      url.searchParams.set('token', token);
      const socket = new WebSocket(url);
      this.socket = socket;
      socket.binaryType = 'arraybuffer';
      const frames = new Reassembler();
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          socket.close();
          reject(new Error('Automerge initial sync timed out'));
        }, 30_000);
        socket.addEventListener('message', event => {
          if (this.socket !== socket || typeof event.data === 'string') return;
          try {
            const bytes = frames.push(new Uint8Array(event.data));
            if (!bytes) return;
            const message = FromRemote.decode(bytes);
            if (message.isRemoteInitialSync()) {
              this.document = A.loadIncremental(this.document, message.value.snapshot);
              this.presence.apply(message.value.awareness);
              this.options.onPresence?.(this.presence.getAllStates());
              this.initialized = true;
              this.ready = true;
              this.send(FromPeer.fromPeerRegisterId({ peerid: this.peerId }).encode());
              for (const [id, update] of this.pending) this.sendUpdate(id, update);
              this.send(FromPeer.fromPeerRequestSince({ vv: encodeRevision(A.getHeads(this.document)) }).encode());
              this.options.onChange?.(this.document);
              clearTimeout(timeout);
              resolve();
            } else if (message.isRemoteAwareness()) {
              this.presence.apply(message.value.awareness);
              this.options.onPresence?.(this.presence.getAllStates());
            } else if (message.isRemoteUpdateAck()) {
              this.pending.delete(message.value.id);
            } else if (message.isRemoteUpdate() || message.isRemoteUpdateSince()) {
              this.document = A.loadIncremental(this.document, message.value.update);
              this.options.onChange?.(this.document);
            } else if (message.isRemoteSnapshot()) {
              this.document = A.loadIncremental(this.document, message.value.snapshot);
              this.options.onChange?.(this.document);
            }
          } catch (error) {
            const failure = error instanceof Error ? error : new Error(String(error));
            this.options.onError?.(failure);
            clearTimeout(timeout);
            reject(failure);
            socket.close();
          }
        });
        socket.addEventListener('close', () => {
          clearTimeout(timeout);
          if (this.socket === socket) this.ready = false;
          reject(new Error('Automerge connection closed before initial sync'));
        });
        socket.addEventListener('error', () => {
          const failure = new Error('Automerge websocket failed');
          this.options.onError?.(failure);
          clearTimeout(timeout);
          socket.close();
          reject(failure);
        });
      });
    } finally {
      if (this.generation === generation) this.connecting = false;
    }
  }

  change(callback: A.ChangeFn<T>): void {
    if (this.disposed) throw new Error('Session is disposed');
    if (!this.initialized) throw new Error('Load the shared document before editing');
    const heads = A.getHeads(this.document);
    this.document = A.change(this.document, callback);
    const update = A.saveSince(this.document, heads);
    if (update.length === 0) return;
    const id = crypto.randomUUID();
    this.pending.set(id, update);
    if (this.ready) this.sendUpdate(id, update);
    this.options.onChange?.(this.document);
  }

  updatePresence(value: unknown): void {
    this.presence.set(this.peerId.toString(), value);
    if (this.ready) this.send(FromPeer.fromPeerAwareness({ awareness: this.presence.encode(this.peerId.toString()) }).encode());
  }

  async flush(timeoutMs = 30_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (this.pending.size > 0) {
      if (Date.now() >= deadline) throw new Error('Automerge updates remain unacknowledged');
      await new Promise(resolve => setTimeout(resolve, 20));
    }
  }

  disconnect(): void {
    this.generation++;
    this.connecting = false;
    this.ready = false;
    const socket = this.socket;
    this.socket = undefined;
    socket?.close();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.disconnect();
    A.free(this.document);
  }

  private sendUpdate(id: string, update: Uint8Array): void {
    this.send(FromPeer.fromPeerUpdate({ id, updates: [update] }).encode());
  }

  private send(bytes: Uint8Array): void {
    const socket = this.socket;
    if (socket?.readyState !== WebSocket.OPEN) throw new Error('Automerge socket is disconnected');
    for (const frame of intoFrames(bytes)) socket.send(frame.slice().buffer);
  }
}

export async function initializeDocument<T>(url: string, token: string, document: A.Doc<T>): Promise<void> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/octet-stream' },
    body: InitializeFromSnapshotRequest.encode({ snapshot: A.save(document) }).slice(),
  });
  if (!response.ok) throw new Error(`Initialize rejected: ${response.status}`);
}
