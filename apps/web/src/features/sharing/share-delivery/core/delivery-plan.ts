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

/**
 * `validate_references` in `crates/messages` rejects a message with more
 * attachments with HTTP 400, before anything is stored or granted.
 */
export const MAX_ATTACHMENTS_PER_MESSAGE = 10;

/** The parts of a recipient-selector option the plan reads. */
export type PickedRecipient =
  | { readonly kind: 'channel'; readonly id: string }
  | { readonly kind: 'user' | 'contact'; readonly id: string }
  | {
      readonly kind: 'custom';
      readonly id: string;
      readonly data: { readonly invalid: boolean };
    };

/**
 * Where one conversation's messages go. It is an existing channel, or people
 * whose DM or group channel exists only after the first send resolves it.
 */
export type ShareTarget =
  | { readonly t: 'channel'; readonly channelId: string }
  | { readonly t: 'people'; readonly userIds: readonly string[] };

declare const targetKeyBrand: unique symbol;

/** Names a target across retries. A group's key ignores recipient order. */
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

/** Two or more recipients and no channel among them. */
export function canSendAsGroup(
  recipients: readonly PickedRecipient[]
): boolean {
  return (
    recipients.length > 1 &&
    recipients.every((recipient) => recipient.kind !== 'channel')
  );
}

/**
 * One target per channel and per person, or one group target when `asGroup`
 * applies. Invalid custom email chips are skipped in both modes, and
 * duplicate keys collapse.
 */
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

/** The sole recipient, when it is a channel. Its existing grants may seed the level. */
export function prefillChannel(
  recipients: readonly PickedRecipient[]
): string | undefined {
  const [only, ...rest] = recipients;
  return only?.kind === 'channel' && rest.length === 0 ? only.id : undefined;
}

/** One share, frozen at its first submit. A retry runs what is left of it. */
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
  /** Minted once. A retry posts under the same id, so the server keeps one copy. */
  readonly id: string;
  /** At most MAX_ATTACHMENTS_PER_MESSAGE, in selection order. */
  readonly items: readonly ShareItem[];
  /** The request text on the target's first message, '' on the rest. */
  readonly text: string;
  /** Granted before the post. Any failure stops the post. */
  readonly grantFirst: readonly GrantStep[];
  readonly grantAfter: readonly GrantStep[];
};

export type TargetPlan = {
  readonly key: TargetKey;
  readonly target: ShareTarget;
  /** In order. A failed send ends the target's run, and a failed grant does not. */
  readonly messages: readonly PlannedMessage[];
};

export type SharePlan = {
  readonly request: ShareRequest;
  readonly targets: readonly TargetPlan[];
};

/**
 * Splits the request into each target's messages and the grants each one
 * owes. Owner-only items the sender does not own are left out.
 */
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

/** What one target has so far. A record exists once the target's channel is known. */
export type TargetRecord = {
  readonly channelId: string;
  /** Ids of planned messages the server confirmed. */
  readonly delivered: ReadonlySet<string>;
  readonly granted: ReadonlyMap<ItemKey, ChannelAccessLevel>;
  /** The latest failed grant per item. A later success clears it. */
  readonly grantErrors: ReadonlyMap<ItemKey, ChannelAccessError>;
};

/** Everything the server confirmed during one share, by target. */
export type DeliveryLedger = ReadonlyMap<TargetKey, TargetRecord>;

export const emptyLedger: DeliveryLedger = new Map();

function updateRecord(
  ledger: DeliveryLedger,
  key: TargetKey,
  channelId: string,
  update: (record: TargetRecord) => TargetRecord
): DeliveryLedger {
  const record = ledger.get(key) ?? {
    channelId,
    delivered: new Set(),
    granted: new Map(),
    grantErrors: new Map(),
  };
  return new Map(ledger).set(key, update(record));
}

export function recordDelivery(
  ledger: DeliveryLedger,
  key: TargetKey,
  delivery: { readonly channelId: string; readonly messageId: string }
): DeliveryLedger {
  return updateRecord(ledger, key, delivery.channelId, (record) => ({
    ...record,
    delivered: new Set(record.delivered).add(delivery.messageId),
  }));
}

/** Records one grant attempt. A before-send grant is how a people target first learns its channel. */
export function recordGrant(
  ledger: DeliveryLedger,
  key: TargetKey,
  grant: {
    readonly channelId: string;
    readonly item: ShareItemRef;
    readonly level: ChannelAccessLevel;
    readonly result: Result<void, ChannelAccessError>;
  }
): DeliveryLedger {
  const id = itemKey(grant.item);
  const { result } = grant;
  return updateRecord(ledger, key, grant.channelId, (record) => {
    const granted = new Map(record.granted);
    const grantErrors = new Map(record.grantErrors);
    if (result.isOk()) {
      granted.set(id, grant.level);
      grantErrors.delete(id);
    } else {
      grantErrors.set(id, result.error);
    }
    return { ...record, granted, grantErrors };
  });
}

/** What a submit still has to do for one target. */
export type TargetWork = {
  readonly key: TargetKey;
  readonly target: ShareTarget;
  /** After-send grants on delivered messages that are unconfirmed and may still succeed. */
  readonly grants: readonly GrantStep[];
  /**
   * Undelivered messages in order, each with only the before-send grants it
   * still owes. A refused before-send grant blocks its message, so that
   * message and every later one are left out.
   */
  readonly messages: readonly PlannedMessage[];
};

const mayRetry = (error: ChannelAccessError | undefined) =>
  error === undefined || error === 'failed';

/** The undone parts of the frozen plan. Targets with nothing left are absent. */
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

    const grants = messages
      .filter(isDelivered)
      .flatMap((message) => message.grantAfter.filter(retryable));
    const undelivered = messages.filter((message) => !isDelivered(message));
    const blocked = undelivered.findIndex((message) =>
      message.grantFirst.some((grant) => !confirmed(grant) && !retryable(grant))
    );
    const sendable = (
      blocked === -1 ? undelivered : undelivered.slice(0, blocked)
    ).map((message) => ({
      ...message,
      grantFirst: message.grantFirst.filter((grant) => !confirmed(grant)),
    }));

    if (grants.length === 0 && sendable.length === 0) return [];
    return [{ key, target, grants, messages: sendable }];
  });
}

export type AccessIssue = {
  readonly item: ShareItem;
  readonly error: ChannelAccessError;
};

export type RecipientOutcome = {
  readonly key: TargetKey;
  readonly target: ShareTarget;
  /** Planned items this target has not received. */
  readonly unsent: readonly ShareItem[];
  /** Owed grants that are not confirmed, on received items or refused before a post. */
  readonly accessIssues: readonly AccessIssue[];
};

export type ShareOutcome = {
  /** Every planned message is delivered and every owed grant is confirmed. */
  readonly complete: boolean;
  /** A retry could change something. Refused grants never make a share retryable. */
  readonly retryable: boolean;
  /** At least one message reached a recipient. */
  readonly delivered: boolean;
  /** One entry per target, in request order. */
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
    delivered: plan.targets.some(({ key, messages }) =>
      messages.some((message) => ledger.get(key)?.delivered.has(message.id))
    ),
    recipients,
  };
}

export type ShareNotice =
  /** Owner-only kinds the sender does not own. They are left out of every message. */
  | { readonly t: 'left-out'; readonly items: readonly ShareItem[] }
  /** Items the sender does not own. Recipients get view from the message, and only the owner can grant more. */
  | { readonly t: 'not-owner'; readonly items: readonly ShareItem[] }
  /** Items whose kind tops out below the chosen level, such as email at view. */
  | {
      readonly t: 'capped';
      readonly items: readonly ShareItem[];
      readonly level: ChannelAccessLevel;
    }
  /** Each recipient gets several messages because one holds at most MAX_ATTACHMENTS_PER_MESSAGE. */
  | { readonly t: 'split'; readonly messagesPerRecipient: number };

/** What the sender is told before sending. */
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
  /** A target first has an item with its owed access settled. Once per target and item. */
  | {
      readonly t: 'forwarded';
      readonly item: ShareItemRef;
      readonly target: 'channel' | 'user';
    }
  /** A grant was confirmed at a new level. */
  | {
      readonly t: 'access-set';
      readonly item: ShareItemRef;
      readonly level: ChannelAccessLevel;
    };

/** The events one submit earned, read off the ledger before and after it. */
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
