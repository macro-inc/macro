export type ShareKind =
  | 'document'
  | 'chat'
  | 'project'
  | 'email'
  | 'agent_session'
  | 'database'
  | 'initiative'
  | 'call';

export const CHANNEL_ACCESS_LEVELS = ['view', 'comment', 'edit'] as const;

export type ChannelAccessLevel = (typeof CHANNEL_ACCESS_LEVELS)[number];

export type ShareItemRef = {
  readonly kind: ShareKind;
  readonly id: string;
};

declare const itemKeyBrand: unique symbol;

export type ItemKey = string & { readonly [itemKeyBrand]: true };

export function itemKey(item: ShareItemRef): ItemKey {
  return `${item.kind}:${item.id}` as ItemKey;
}

export type ShareItem = ShareItemRef & {
  readonly name: string;
  readonly markdown: boolean;
  readonly canGrant: boolean;
  readonly channelGrants: ReadonlyMap<string, ChannelAccessLevel>;
};

export type ChannelAccessChange =
  | {
      readonly t: 'set';
      readonly channelId: string;
      readonly level: ChannelAccessLevel;
    }
  | { readonly t: 'remove'; readonly channelId: string };

export type ChannelAccessError = 'not-allowed' | 'unsupported' | 'failed';

type KindPolicy = {
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
  agent_session: { grant: 'after-send', maxLevel: 'edit', send: 'owner-only' },
  initiative: { grant: 'before-send', maxLevel: 'edit', send: 'owner-only' },
  call: { grant: 'message-only', maxLevel: 'view', send: 'anyone' },
} as const satisfies Record<ShareKind, KindPolicy>;

export type OwnerOnlyKind = {
  [K in ShareKind]: (typeof KIND_POLICY)[K]['send'] extends 'owner-only'
    ? K
    : never;
}[ShareKind];

export function isOwnerOnlyToSend(kind: ShareKind): kind is OwnerOnlyKind {
  return KIND_POLICY[kind].send === 'owner-only';
}

export type ShareAccess =
  | { readonly t: 'cannot-send' }
  | { readonly t: 'view-via-message' }
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

export function owedGrant(
  item: ShareItem,
  chosen: ChannelAccessLevel
): OwedGrant | undefined {
  const access = shareAccess(item);
  if (access.t !== 'set-level') return undefined;
  return { when: access.when, level: lowerOf(chosen, access.maxLevel) };
}

export type LevelChoice = {
  readonly options: readonly ChannelAccessLevel[];
  readonly initial: ChannelAccessLevel;
};

export type LevelChoiceInput = {
  readonly prefillChannelId?: string;
  readonly markdownComments: boolean;
};

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

  const initial = settable
    .filter((entry) => entry.maxLevel !== 'view')
    .map((entry): ChannelAccessLevel => (entry.item.markdown ? 'edit' : 'view'))
    .reduce(lowerOf, top);
  return { options, initial };
}

export function parseChannelAccessLevel(
  level: string
): ChannelAccessLevel | undefined {
  return CHANNEL_ACCESS_LEVELS.find((known) => known === level);
}

export function isBelow(a: ChannelAccessLevel, b: ChannelAccessLevel): boolean {
  return CHANNEL_ACCESS_LEVELS.indexOf(a) < CHANNEL_ACCESS_LEVELS.indexOf(b);
}

function lowerOf(
  a: ChannelAccessLevel,
  b: ChannelAccessLevel
): ChannelAccessLevel {
  return isBelow(a, b) ? a : b;
}
