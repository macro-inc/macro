import { createCrossTabBus } from '@core/cross-tab/cross-tab-bus';

export type DraftLifecycleChange = {
  draftId: string;
  inboxId?: string;
  changedAt: number;
  restoration?: {
    originalDraftId: string;
    threadId: string;
    replyingToId?: string | null;
    includeSignature?: boolean | null;
  };
};

const lifecycleBus = createCrossTabBus<DraftLifecycleChange>({
  channelName: 'macro-email-draft-lifecycle',
  storageKey: 'macro:email-draft-lifecycle',
  parse(value) {
    if (typeof value !== 'object' || value === null) return null;
    const candidate = value as Partial<DraftLifecycleChange>;
    if (
      typeof candidate.draftId !== 'string' ||
      typeof candidate.changedAt !== 'number' ||
      (candidate.inboxId !== undefined && typeof candidate.inboxId !== 'string')
    ) {
      return null;
    }
    const restoration = candidate.restoration;
    if (
      restoration !== undefined &&
      (typeof restoration !== 'object' ||
        restoration === null ||
        typeof restoration.originalDraftId !== 'string' ||
        typeof restoration.threadId !== 'string' ||
        (restoration.replyingToId != null &&
          typeof restoration.replyingToId !== 'string') ||
        (restoration.includeSignature != null &&
          typeof restoration.includeSignature !== 'boolean'))
    )
      return null;
    return candidate as DraftLifecycleChange;
  },
  getMessageKey: (message) =>
    `${message.draftId}:${message.inboxId ?? ''}:${message.changedAt}:${message.restoration ? 'restored' : 'changed'}`,
});

export function publishDraftLifecycleChange(
  draftId: string,
  inboxId?: string
): void {
  lifecycleBus.publish({ draftId, inboxId, changedAt: Date.now() });
}

/** Only identity is broadcast; mounted editors reread the restored durable draft. */
export function publishDraftRestoration(
  change: Omit<DraftLifecycleChange, 'changedAt'> & {
    restoration: NonNullable<DraftLifecycleChange['restoration']>;
  }
): void {
  lifecycleBus.publish({ ...change, changedAt: Date.now() });
}

export function subscribeToDraftLifecycleChanges(
  listener: (change: DraftLifecycleChange) => void
): VoidFunction {
  return lifecycleBus.subscribe(listener);
}
