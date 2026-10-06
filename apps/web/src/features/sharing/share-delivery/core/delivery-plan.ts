import type { Result } from 'neverthrow';
import { match } from 'ts-pattern';
import {
  CHANNEL_ACCESS_LEVELS,
  type ChannelAccessError,
  type ChannelAccessLevel,
  type ItemKey,
  isBelow,
  itemKey,
  type OwedGrant,
  owedGrant,
  type ShareItem,
  type ShareItemRef,
  shareAccess,
} from './share-item';

export const MAX_ATTACHMENTS_PER_MESSAGE = 10;

export type PickedRecipient =
  | { readonly kind: 'channel'; readonly id: string }
  | { readonly kind: 'user' | 'contact'; readonly id: string }
  | {
      readonly kind: 'custom';
      readonly id: string;
      readonly data: { readonly invalid: boolean };
    };

export type ShareTarget =
  | { readonly t: 'channel'; readonly channelId: string }
  | { readonly t: 'people'; readonly userIds: readonly string[] };

declare const targetKeyBrand: unique symbol;

export type TargetKey = string & { readonly [targetKeyBrand]: true };

export function targetKey(target: ShareTarget): TargetKey {
  const key = match(target)
    .with({ t: 'channel' }, ({ channelId }) => `channel:${channelId}`)
    .with(
      { t: 'people' },
      ({ userIds }) => `people:${userIds.toSorted().join(',')}`
    )
    .exhaustive();
  return key as TargetKey;
}

export function canSendAsGroup(
  recipients: readonly PickedRecipient[]
): boolean {
  return (
    recipients.length > 1 &&
    recipients.every((recipient) => recipient.kind !== 'channel')
  );
}

export function targetsFor(
  recipients: readonly PickedRecipient[],
  asGroup: boolean
): readonly ShareTarget[] {
  const valid = recipients.filter(
    (recipient) => recipient.kind !== 'custom' || !recipient.data.invalid
  );
  if (asGroup && canSendAsGroup(recipients)) {
    if (valid.length === 0) return [];
    return [{ t: 'people', userIds: valid.map((recipient) => recipient.id) }];
  }
  const targets = new Map<TargetKey, ShareTarget>();
  for (const recipient of valid) {
    const target: ShareTarget =
      recipient.kind === 'channel'
        ? { t: 'channel', channelId: recipient.id }
        : { t: 'people', userIds: [recipient.id] };
    targets.set(targetKey(target), target);
  }
  return [...targets.values()];
}

export function prefillChannel(
  recipients: readonly PickedRecipient[]
): string | undefined {
  const [only, ...rest] = recipients;
  return only?.kind === 'channel' && rest.length === 0 ? only.id : undefined;
}

export type ShareRequest = {
  readonly items: readonly ShareItem[];
  readonly targets: readonly ShareTarget[];
  readonly text: string;
  readonly level: ChannelAccessLevel;
};

export type GrantStep = {
  readonly item: ShareItem;
  readonly level: ChannelAccessLevel;
};

export type PlannedMessage = {
  readonly id: string;
  readonly items: readonly ShareItem[];
  readonly text: string;
  readonly grantFirst: readonly GrantStep[];
  readonly grantAfter: readonly GrantStep[];
};

export type TargetPlan = {
  readonly key: TargetKey;
  readonly target: ShareTarget;
  readonly messages: readonly PlannedMessage[];
};

export type SharePlan = {
  readonly request: ShareRequest;
  readonly targets: readonly TargetPlan[];
};

export function planShare(
  request: ShareRequest,
  mintMessageId: () => string
): SharePlan {
  const sendable = request.items.filter(
    (item) => shareAccess(item).t !== 'cannot-send'
  );
  const chunks = Array.from(
    { length: Math.ceil(sendable.length / MAX_ATTACHMENTS_PER_MESSAGE) },
    (_, index) =>
      sendable.slice(
        index * MAX_ATTACHMENTS_PER_MESSAGE,
        (index + 1) * MAX_ATTACHMENTS_PER_MESSAGE
      )
  );
  const grants = (items: readonly ShareItem[], when: OwedGrant['when']) =>
    items.flatMap((item) => {
      const owed = owedGrant(item, request.level);
      return owed?.when === when ? [{ item, level: owed.level }] : [];
    });
  return {
    request,
    targets: request.targets.map((target) => ({
      key: targetKey(target),
      target,
      messages: chunks.map((items, index) => ({
        id: mintMessageId(),
        items,
        text: index === 0 ? request.text : '',
        grantFirst: grants(items, 'before-send'),
        grantAfter: grants(items, 'after-send'),
      })),
    })),
  };
}

export type TargetRecord = {
  readonly channelId: string;
  readonly delivered: ReadonlySet<string>;
  readonly granted: ReadonlyMap<ItemKey, ChannelAccessLevel>;
  readonly grantErrors: ReadonlyMap<ItemKey, ChannelAccessError>;
};

export type DeliveryLedger = ReadonlyMap<TargetKey, TargetRecord>;

export const emptyLedger: DeliveryLedger = new Map();

export function emptyRecord(channelId: string): TargetRecord {
  return {
    channelId,
    delivered: new Set(),
    granted: new Map(),
    grantErrors: new Map(),
  };
}

export function withDelivery(
  record: TargetRecord,
  messageId: string
): TargetRecord {
  return { ...record, delivered: new Set(record.delivered).add(messageId) };
}

export function withGrant(
  record: TargetRecord,
  grant: {
    readonly item: ShareItemRef;
    readonly level: ChannelAccessLevel;
    readonly result: Result<void, ChannelAccessError>;
  }
): TargetRecord {
  const id = itemKey(grant.item);
  const granted = new Map(record.granted);
  const grantErrors = new Map(record.grantErrors);
  if (grant.result.isOk()) {
    granted.set(id, grant.level);
    grantErrors.delete(id);
  } else {
    grantErrors.set(id, grant.result.error);
  }
  return { ...record, granted, grantErrors };
}

export type TargetWork = {
  readonly key: TargetKey;
  readonly channel:
    | { readonly t: 'known'; readonly record: TargetRecord }
    | { readonly t: 'unknown'; readonly userIds: readonly string[] };
  readonly pendingGrants: readonly GrantStep[];
  readonly unsentMessages: readonly PlannedMessage[];
};

const mayRetry = (error: ChannelAccessError | undefined) =>
  error === undefined || error === 'failed';

export function remainingWork(
  plan: SharePlan,
  ledger: DeliveryLedger
): readonly TargetWork[] {
  return plan.targets.flatMap(({ key, target, messages }) => {
    const record = ledger.get(key);
    const confirmed = (grant: GrantStep) =>
      record?.granted.get(itemKey(grant.item)) === grant.level;
    const retryable = (grant: GrantStep) =>
      !confirmed(grant) &&
      mayRetry(record?.grantErrors.get(itemKey(grant.item)));
    const isDelivered = (message: PlannedMessage) =>
      record?.delivered.has(message.id) ?? false;

    const pendingGrants = messages
      .filter(isDelivered)
      .flatMap((message) => message.grantAfter.filter(retryable));
    const undelivered = messages.filter((message) => !isDelivered(message));
    const blocked = undelivered.findIndex((message) =>
      message.grantFirst.some((grant) => !confirmed(grant) && !retryable(grant))
    );
    const unsentMessages = (
      blocked === -1 ? undelivered : undelivered.slice(0, blocked)
    ).map((message) => ({
      ...message,
      grantFirst: message.grantFirst.filter((grant) => !confirmed(grant)),
    }));

    if (pendingGrants.length === 0 && unsentMessages.length === 0) return [];
    const channel: TargetWork['channel'] = record
      ? { t: 'known', record }
      : target.t === 'channel'
        ? { t: 'known', record: emptyRecord(target.channelId) }
        : { t: 'unknown', userIds: target.userIds };
    return [{ key, channel, pendingGrants, unsentMessages }];
  });
}

export type AccessIssue = {
  readonly item: ShareItem;
  readonly error: ChannelAccessError;
};

export type RecipientOutcome = {
  readonly key: TargetKey;
  readonly target: ShareTarget;
  readonly unsent: readonly ShareItem[];
  readonly accessIssues: readonly AccessIssue[];
};

export type ShareOutcome = {
  readonly complete: boolean;
  readonly retryable: boolean;
  readonly anyDelivered: boolean;
  readonly recipients: readonly RecipientOutcome[];
};

export function summarizeShare(
  plan: SharePlan,
  ledger: DeliveryLedger
): ShareOutcome {
  const recipients = plan.targets.map(({ key, target, messages }) => {
    const record = ledger.get(key);
    const isDelivered = (message: PlannedMessage) =>
      record?.delivered.has(message.id) ?? false;
    const unsent = messages
      .filter((message) => !isDelivered(message))
      .flatMap((message) => message.items);
    const accessIssues = messages.flatMap((message) =>
      [...message.grantFirst, ...message.grantAfter].flatMap(
        ({ item, level }) => {
          const id = itemKey(item);
          if (record?.granted.get(id) === level) return [];
          const error = record?.grantErrors.get(id);
          if (error === undefined && !isDelivered(message)) return [];
          return [{ item, error: error ?? 'failed' }];
        }
      )
    );
    return { key, target, unsent, accessIssues };
  });
  return {
    complete: recipients.every(
      ({ unsent, accessIssues }) =>
        unsent.length === 0 && accessIssues.length === 0
    ),
    retryable: remainingWork(plan, ledger).length > 0,
    anyDelivered: plan.targets.some(({ key, messages }) =>
      messages.some((message) => ledger.get(key)?.delivered.has(message.id))
    ),
    recipients,
  };
}

export type ShareNotice =
  | { readonly t: 'left-out'; readonly items: readonly ShareItem[] }
  | { readonly t: 'not-owner'; readonly items: readonly ShareItem[] }
  | {
      readonly t: 'capped';
      readonly items: readonly ShareItem[];
      readonly level: ChannelAccessLevel;
    }
  | { readonly t: 'split'; readonly messagesPerRecipient: number };

export function shareNotices(
  items: readonly ShareItem[],
  level: ChannelAccessLevel
): readonly ShareNotice[] {
  const leftOut = items.filter((item) => shareAccess(item).t === 'cannot-send');
  const sendable = items.filter(
    (item) => shareAccess(item).t !== 'cannot-send'
  );
  const notOwned = sendable.filter((item) => !item.canGrant);
  const grantedLevel = (item: ShareItem) =>
    owedGrant(item, level)?.level ?? 'view';
  const capped = CHANNEL_ACCESS_LEVELS.filter((cap) =>
    isBelow(cap, level)
  ).flatMap((cap) => {
    const atCap = sendable.filter(
      (item) => item.canGrant && grantedLevel(item) === cap
    );
    return atCap.length > 0
      ? [{ t: 'capped' as const, items: atCap, level: cap }]
      : [];
  });
  const messagesPerRecipient = Math.ceil(
    sendable.length / MAX_ATTACHMENTS_PER_MESSAGE
  );

  return [
    ...(leftOut.length > 0 ? [{ t: 'left-out' as const, items: leftOut }] : []),
    ...(notOwned.length > 0
      ? [{ t: 'not-owner' as const, items: notOwned }]
      : []),
    ...capped,
    ...(messagesPerRecipient > 1
      ? [{ t: 'split' as const, messagesPerRecipient }]
      : []),
  ];
}

export type ShareEvent =
  | {
      readonly t: 'forwarded';
      readonly item: ShareItemRef;
      readonly target: 'channel' | 'user';
    }
  | {
      readonly t: 'access-set';
      readonly item: ShareItemRef;
      readonly level: ChannelAccessLevel;
    };

export function shareEvents(
  plan: SharePlan,
  before: DeliveryLedger,
  after: DeliveryLedger
): readonly ShareEvent[] {
  return plan.targets.flatMap(({ key, target, messages }) => {
    const was = before.get(key);
    const now = after.get(key);
    const targetType = match(target)
      .with({ t: 'channel' }, () => 'channel' as const)
      .with({ t: 'people' }, () => 'user' as const)
      .exhaustive();
    return messages.flatMap((message) =>
      message.items.flatMap((item): ShareEvent[] => {
        const id = itemKey(item);
        const owed = [...message.grantFirst, ...message.grantAfter].find(
          (grant) => itemKey(grant.item) === id
        );
        const settled = (record: TargetRecord | undefined) =>
          record !== undefined &&
          record.delivered.has(message.id) &&
          (owed === undefined || record.granted.get(id) === owed.level);
        const level = now?.granted.get(id);
        return [
          ...(level !== undefined && level !== was?.granted.get(id)
            ? [{ t: 'access-set' as const, item, level }]
            : []),
          ...(settled(now) && !settled(was)
            ? [{ t: 'forwarded' as const, item, target: targetType }]
            : []),
        ];
      })
    );
  });
}
