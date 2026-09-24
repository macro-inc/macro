import { createCrossTabBus } from '@core/cross-tab/cross-tab-bus';

export type DraftLifecycleChange = {
  draftId: string;
  inboxId?: string;
  changedAt: number;
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
    return candidate as DraftLifecycleChange;
  },
  getMessageKey: (message) =>
    `${message.draftId}:${message.inboxId ?? ''}:${message.changedAt}`,
});

export function publishDraftLifecycleChange(
  draftId: string,
  inboxId?: string
): void {
  lifecycleBus.publish({ draftId, inboxId, changedAt: Date.now() });
}

export function subscribeToDraftLifecycleChanges(
  listener: (change: DraftLifecycleChange) => void
): VoidFunction {
  return lifecycleBus.subscribe(listener);
}
