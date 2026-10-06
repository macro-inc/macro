/**
 * Every kind the share engine can deliver. `shareable-entity.ts` decides which
 * list rows offer Share, and blocks share the rest.
 */
export type ShareKind =
  | 'document'
  | 'chat'
  | 'project'
  | 'email'
  | 'agent_session'
  | 'database'
  | 'initiative'
  | 'call';

/** Levels a channel can hold, lowest first. A channel is never granted owner. */
export const CHANNEL_ACCESS_LEVELS = ['view', 'comment', 'edit'] as const;

export type ChannelAccessLevel = (typeof CHANNEL_ACCESS_LEVELS)[number];

export type ShareItemRef = {
  readonly kind: ShareKind;
  readonly id: string;
};

declare const itemKeyBrand: unique symbol;

/** Names one item. Two kinds can share an id, so every ledger keys by this. */
export type ItemKey = string & { readonly [itemKeyBrand]: true };

export function itemKey(item: ShareItemRef): ItemKey {
  return `${item.kind}:${item.id}` as ItemKey;
}

export type ShareItem = ShareItemRef & {
  readonly name: string;
  /** Markdown aliases (md, task, snippet, skill) default to edit. */
  readonly markdown: boolean;
  /** The sender may set explicit channel grants. It is a prediction, and the server decides. */
  readonly canGrant: boolean;
  /** Existing grants by channel id. Empty when the caller never fetched them. */
  readonly channelGrants: ReadonlyMap<string, ChannelAccessLevel>;
};

export type ChannelAccessChange =
  | {
      readonly t: 'set';
      readonly channelId: string;
      readonly level: ChannelAccessLevel;
    }
  | { readonly t: 'remove'; readonly channelId: string };

/**
 * `not-allowed` means the server refused the sender (401 or 403), so a retry
 * cannot help. `unsupported` means the kind has no channel grant client.
 * `failed` is anything else, so a retry may succeed.
 */
export type ChannelAccessError = 'not-allowed' | 'unsupported' | 'failed';

type KindPolicy = {
  /**
   * When the explicit grant runs relative to the message that attaches the
   * item. Granting after the post means a failed message never leaves a
   * channel holding access to something it did not receive.
   */
  readonly grant: 'after-send' | 'before-send' | 'message-only';
  readonly maxLevel: ChannelAccessLevel;
  readonly send: 'anyone' | 'owner-only';
};

const KIND_POLICY = {
  document: { grant: 'after-send', maxLevel: 'edit', send: 'anyone' },
  chat: { grant: 'after-send', maxLevel: 'edit', send: 'anyone' },
  project: { grant: 'after-send', maxLevel: 'edit', send: 'anyone' },
  database: { grant: 'after-send', maxLevel: 'edit', send: 'anyone' },
  email: { grant: 'after-send', maxLevel: 'view', send: 'anyone' },
  // The message's auto-grant covers a session only when its stored owner
  // sends it, and the agent harness accepts grants only from that owner.
  agent_session: { grant: 'after-send', maxLevel: 'edit', send: 'owner-only' },
  // Nothing grants a native project on send. The grant runs first so no
  // recipient gets an attachment they cannot open, and a failed grant stops
  // the post.
  initiative: { grant: 'before-send', maxLevel: 'edit', send: 'owner-only' },
  // Calls have no channel grant client. The message's auto-grant gives view.
  call: { grant: 'message-only', maxLevel: 'view', send: 'anyone' },
} as const satisfies Record<ShareKind, KindPolicy>;

/** Kinds only their owner may attach to a message. */
export type OwnerOnlyKind = {
  [K in ShareKind]: (typeof KIND_POLICY)[K]['send'] extends 'owner-only'
    ? K
    : never;
}[ShareKind];

export function isOwnerOnlyToSend(kind: ShareKind): kind is OwnerOnlyKind {
  return KIND_POLICY[kind].send === 'owner-only';
}

/** What the sender can do with one item. Every other rule reads this. */
export type ShareAccess =
  /** An owner-only kind the sender does not own. Left out of every message. */
  | { readonly t: 'cannot-send' }
  /** Sent. Recipients get view from the message's auto-grant. */
  | { readonly t: 'view-via-message' }
  /** Sent and explicitly granted at the chosen level, capped at `maxLevel`. */
  | {
      readonly t: 'set-level';
      readonly when: 'after-send' | 'before-send';
      readonly maxLevel: ChannelAccessLevel;
    };

export function shareAccess(item: ShareItem): ShareAccess {
  const policy = KIND_POLICY[item.kind];
  if (policy.send === 'owner-only' && !item.canGrant)
    return { t: 'cannot-send' };
  if (policy.grant === 'message-only' || !item.canGrant)
    return { t: 'view-via-message' };
  return { t: 'set-level', when: policy.grant, maxLevel: policy.maxLevel };
}

export type OwedGrant = {
  readonly when: 'after-send' | 'before-send';
  readonly level: ChannelAccessLevel;
};

/** The explicit grant one item owes each recipient channel, if any. */
export function owedGrant(
  item: ShareItem,
  chosen: ChannelAccessLevel
): OwedGrant | undefined {
  const access = shareAccess(item);
  if (access.t !== 'set-level') return undefined;
  return { when: access.when, level: lowerOf(chosen, access.maxLevel) };
}

export type LevelChoice = {
  /** Ascending, up to the highest level any item can be granted. */
  readonly options: readonly ChannelAccessLevel[];
  readonly initial: ChannelAccessLevel;
};

export type LevelChoiceInput = {
  /** The sole recipient, when it is one channel. */
  readonly prefillChannelId?: string;
  /** Inside a markdown block the share dialog offers comment only while markdown comments are on. */
  readonly markdownComments: boolean;
};

/**
 * The level control a share form shows, or undefined when nothing can be
 * granted above view (email only, nothing owned, calls).
 *
 * The prefill channel's existing grant seeds the control only when every
 * settable item already has that same level there. Otherwise the control
 * starts at the lowest level the single dialog would default any one item to.
 */
export function levelChoice(
  items: readonly ShareItem[],
  { prefillChannelId, markdownComments }: LevelChoiceInput
): LevelChoice | undefined {
  const settable = items.flatMap((item) => {
    const access = shareAccess(item);
    return access.t === 'set-level'
      ? [{ item, maxLevel: access.maxLevel }]
      : [];
  });
  const top = CHANNEL_ACCESS_LEVELS.findLast((level) =>
    settable.some((entry) => entry.maxLevel === level)
  );
  if (top === undefined || top === 'view') return undefined;

  const hideComment =
    !markdownComments && settable.some((entry) => entry.item.markdown);
  const options = CHANNEL_ACCESS_LEVELS.filter(
    (level) => !isBelow(top, level) && !(hideComment && level === 'comment')
  );

  const existing =
    prefillChannelId === undefined
      ? []
      : settable.map((entry) => entry.item.channelGrants.get(prefillChannelId));
  const [shared] = existing;
  if (shared !== undefined && existing.every((level) => level === shared)) {
    const seeded = lowerOf(shared, top);
    if (options.includes(seeded)) return { options, initial: seeded };
  }

  // Email tops out at view, so it does not pull a batch's default down.
  const initial = settable
    .filter((entry) => entry.maxLevel !== 'view')
    .map((entry): ChannelAccessLevel => (entry.item.markdown ? 'edit' : 'view'))
    .reduce(lowerOf, top);
  return { options, initial };
}

/** Narrows a wire access level. Owner and unknown strings are not channel levels. */
export function parseChannelAccessLevel(
  level: string
): ChannelAccessLevel | undefined {
  return CHANNEL_ACCESS_LEVELS.find((known) => known === level);
}

/** Whether `a` grants less than `b`. */
export function isBelow(a: ChannelAccessLevel, b: ChannelAccessLevel): boolean {
  return CHANNEL_ACCESS_LEVELS.indexOf(a) < CHANNEL_ACCESS_LEVELS.indexOf(b);
}

function lowerOf(
  a: ChannelAccessLevel,
  b: ChannelAccessLevel
): ChannelAccessLevel {
  return isBelow(a, b) ? a : b;
}
