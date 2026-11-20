import { v7 } from 'uuid';
import { unwrap } from '../../../../packages/sdk/src/utils';
import { type ChannelBindings, channelClient } from './channel';

export type Receipt = {
  messageId: string;
  mintedAt: number;
  delivered: boolean;
};
type ReceiptStorage = {
  get(key: string): Promise<Receipt | undefined>;
  put(key: string, value: Receipt): Promise<void>;
};

// One object per invoice/channel. Concurrent webhook retries share the in-flight post.
export class InvoiceDelivery {
  private pending?: Promise<void>;

  constructor(
    private state: { storage: ReceiptStorage },
    private env: ChannelBindings
  ) {}

  async fetch(request: Request): Promise<Response> {
    const { channelId, content } = (await request.json()) as {
      channelId: string;
      content: string;
    };
    this.pending ??= this.deliver(channelId, content).finally(() => {
      this.pending = undefined;
    });
    await this.pending;
    return new Response(null, { status: 204 });
  }

  private async deliver(channelId: string, content: string) {
    const { storage } = this.state;
    let receipt = await storage.get('receipt');
    if (receipt?.delivered) return;
    const client = channelClient(this.env)._client.storage;
    const path = { parent_type: 'channel', parent_id: channelId };
    if (receipt) {
      const result = await client.entityMessageGetMessage({
        path: { ...path, id: receipt.messageId },
      });
      if (result.response?.status !== 404) {
        unwrap(result);
        await storage.put('receipt', { ...receipt, delivered: true });
        return;
      }
    }
    const now = Date.now();
    // Macro accepts client UUIDv7 timestamps within one day of its clock.
    // Replace an expired ID only after Macro has confirmed it is absent.
    if (!receipt || now - receipt.mintedAt >= 24 * 60 * 60 * 1000) {
      receipt = {
        messageId: v7({ msecs: now }),
        mintedAt: now,
        delivered: false,
      };
      await storage.put('receipt', receipt);
    }
    unwrap(
      await client.entityMessageCreate({
        path,
        body: { id: receipt.messageId, content },
      })
    );
    await storage.put('receipt', { ...receipt, delivered: true });
  }
}
