export type ShareKind =
  | 'document'
  | 'chat'
  | 'project'
  | 'email'
  | 'agent_session'
  | 'database'
  | 'initiative'
  | 'call'
  | 'form'
  | 'crm_pipeline'
  | 'foreign';

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

export type ShareFormat = 'markdown' | 'pdf' | 'other';

export type ShareItem = ShareItemRef & {
  readonly name: string;
  readonly format: ShareFormat;
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

export type ChannelAccessError =
  | { readonly kind: 'not-allowed' }
  | { readonly kind: 'unsupported' }
  | { readonly kind: 'failed' };

type KindPolicy = {
  readonly grant: 'after-send' | 'before-send' | 'message-only';
  /** `restricted`: only a sender who can grant access may send it. */
  readonly send: 'anyone' | 'restricted';
  /** Recipients cannot hold comment access. */
  readonly comment?: false;
};

const KIND_POLICY = {
  document: { grant: 'after-send', send: 'anyone' },
  chat: { grant: 'after-send', send: 'anyone' },
  project: { grant: 'after-send', send: 'anyone' },
  database: { grant: 'after-send', send: 'anyone' },
  form: { grant: 'after-send', send: 'anyone', comment: false },
  // Edit on a shared thread lets the recipient reply from their own inbox.
  email: { grant: 'after-send', send: 'anyone', comment: false },
  agent_session: { grant: 'after-send', send: 'restricted' },
  initiative: { grant: 'before-send', send: 'restricted' },
  crm_pipeline: { grant: 'before-send', send: 'restricted' },
  call: { grant: 'message-only', send: 'anyone' },
  // A pull request's access follows GitHub, so sharing one only sends it.
  foreign: { grant: 'message-only', send: 'anyone' },
} as const satisfies Record<ShareKind, KindPolicy>;

export type RestrictedKind = {
  [K in ShareKind]: (typeof KIND_POLICY)[K]['send'] extends 'restricted'
    ? K
    : never;
}[ShareKind];

export function isSendRestricted(kind: ShareKind): kind is RestrictedKind {
  return KIND_POLICY[kind].send === 'restricted';
}

export type ShareAccess =
  | { readonly t: 'cannot-send' }
  | { readonly t: 'view-via-message' }
  | { readonly t: 'set-level'; readonly when: 'after-send' | 'before-send' };

export function shareAccess(item: ShareItem): ShareAccess {
  const policy = KIND_POLICY[item.kind];
  if (policy.send === 'restricted' && !item.canGrant)
    return { t: 'cannot-send' };
  if (policy.grant === 'message-only' || !item.canGrant)
    return { t: 'view-via-message' };
  return { t: 'set-level', when: policy.grant };
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
  return { when: access.when, level: chosen };
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
  const settable = items.filter((item) => shareAccess(item).t === 'set-level');
  if (settable.length === 0) return undefined;

  const hideComment = settable.some(
    (item) => !takesComment(item, markdownComments)
  );
  const options = CHANNEL_ACCESS_LEVELS.filter(
    (level) => !(hideComment && level === 'comment')
  );

  const existing =
    prefillChannelId === undefined
      ? []
      : settable.map((item) => item.channelGrants.get(prefillChannelId));
  const [shared] = existing;
  if (
    shared !== undefined &&
    existing.every((level) => level === shared) &&
    options.includes(shared)
  ) {
    return { options, initial: shared };
  }

  const initial = settable
    .map((item) => DEFAULT_LEVEL[item.format])
    .reduce(lowerOf, 'edit');
  return {
    options,
    initial: hideComment && initial === 'comment' ? 'view' : initial,
  };
}

const DEFAULT_LEVEL = {
  markdown: 'edit',
  pdf: 'comment',
  other: 'view',
} as const satisfies Record<ShareFormat, ChannelAccessLevel>;

function takesComment(item: ShareItem, markdownComments: boolean): boolean {
  const policy: KindPolicy = KIND_POLICY[item.kind];
  return (
    policy.comment !== false && (markdownComments || item.format !== 'markdown')
  );
}

export function parseChannelAccessLevel(
  level: string
): ChannelAccessLevel | undefined {
  return CHANNEL_ACCESS_LEVELS.find((known) => known === level);
}

function isBelow(a: ChannelAccessLevel, b: ChannelAccessLevel): boolean {
  return CHANNEL_ACCESS_LEVELS.indexOf(a) < CHANNEL_ACCESS_LEVELS.indexOf(b);
}

function lowerOf(
  a: ChannelAccessLevel,
  b: ChannelAccessLevel
): ChannelAccessLevel {
  return isBelow(a, b) ? a : b;
}
