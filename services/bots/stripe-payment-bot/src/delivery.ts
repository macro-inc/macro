import { v7 } from 'uuid';

export type Receipt = {
  messageId: string;
  mintedAt: number;
  delivered: boolean;
};
export type ReceiptStorage = {
  get(key: string): Promise<Receipt | undefined>;
  put(key: string, value: Receipt): Promise<void>;
};

type MessageDestination = {
  exists(messageId: string): Promise<boolean>;
  create(messageId: string): Promise<void>;
};

// Each object owns one invoice/channel pair. Persist the message ID before the
// remote write so a lost acknowledgement or object restart can be reconciled.
export async function deliverInvoice(
  storage: ReceiptStorage,
  destination: MessageDestination
) {
  let receipt = await storage.get('receipt');
  if (receipt?.delivered) return;
  if (receipt && (await destination.exists(receipt.messageId))) {
    await storage.put('receipt', { ...receipt, delivered: true });
    return;
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
  await destination.create(receipt.messageId);
  await storage.put('receipt', { ...receipt, delivered: true });
}
