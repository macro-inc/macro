import { createHash } from 'node:crypto';
import type { Page } from '@playwright/test';
import {
  FromPeer,
  FromRemote,
} from '../../../../packages/collaboration/src/sync-service/generated/schema';
import { Reassembler } from '../../../../packages/collaboration/src/websocket/platform/framing/frames';

export class DocumentReceipts {
  readonly sent: { doc: string; id: string; hashes: string[] }[] = [];
  readonly acknowledged = new Set<string>();
  readonly errors: string[] = [];

  constructor(page: Page) {
    page.on('websocket', (socket) => {
      if (!/\/document\/[^/]+\/connect$/.test(new URL(socket.url()).pathname))
        return;
      const doc = new URL(socket.url()).pathname.split('/').at(-2);
      if (!doc) throw new Error('Missing document socket ID');
      const outbound = new Reassembler();
      const inbound = new Reassembler();
      socket.on('framesent', ({ payload }) => {
        try {
          if (typeof payload === 'string') {
            if (payload === 'ping' || payload === 'pong') return;
            throw new Error('Unexpected text document frame');
          }
          const bytes = outbound.push(payload);
          if (!bytes) return;
          const message = FromPeer.decode(bytes);
          if (message.isPeerUpdate())
            this.sent.push({
              doc,
              id: message.value.id,
              hashes: message.value.updates.map((value) =>
                createHash('sha256').update(value).digest('hex')
              ),
            });
        } catch (error) {
          this.errors.push(String(error));
        }
      });
      socket.on('framereceived', ({ payload }) => {
        try {
          if (typeof payload === 'string') {
            if (payload === 'ping' || payload === 'pong') return;
            throw new Error('Unexpected text document frame');
          }
          const bytes = inbound.push(payload);
          if (!bytes) return;
          const message = FromRemote.decode(bytes);
          if (message.isRemoteUpdateAck())
            this.acknowledged.add(`${doc}:${message.value.id}`);
        } catch (error) {
          this.errors.push(String(error));
        }
      });
    });
  }
}
