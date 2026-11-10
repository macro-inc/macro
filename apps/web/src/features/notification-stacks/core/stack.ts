/** Where a stack's rule matches notifications from. */
export type StackSource =
  | { type: 'channel'; id: string }
  /** Every channel whose name contains the text; never a direct message. */
  | { type: 'channelNameContains'; text: string }
  /** One document or task: the comments on it. */
  | { type: 'document'; id: string }
  /** Everything filed in a folder or in a folder below it. */
  | { type: 'folder'; id: string }
  /** A task project: its discussion and the tasks in it. */
  | { type: 'project'; id: string };

/** A source that names one thing by id. */
export type StackEntitySource = Exclude<
  StackSource,
  { type: 'channelNameContains' }
>;

/** The kinds of thing a rule can name: the sources with an id, and people. */
export type StackEntityKind = StackEntitySource['type'] | 'person';

/** Entity kinds in the order the editor offers them. */
export const STACK_ENTITY_KINDS: readonly StackEntityKind[] = [
  'channel',
  'document',
  'folder',
  'project',
  'person',
];

/** What kind of notification a rule matches, wherever it happened. */
export type StackKind =
  | 'mention'
  | 'reply'
  | 'newMessage'
  | 'reaction'
  | 'documentMention'
  | 'comment';

/** Kinds in the order the editor lists them. */
export const STACK_KINDS: readonly StackKind[] = [
  'newMessage',
  'mention',
  'reply',
  'reaction',
  'documentMention',
  'comment',
];

export type StackChannelType = 'public' | 'private' | 'directMessage' | 'team';

/**
 * One rule. It matches when every condition it sets holds; a condition is set
 * when its list has a value, and holds when any of its values matches.
 */
export type StackRule = {
  sources: readonly StackSource[];
  channelTypes: readonly StackChannelType[];
  kinds: readonly StackKind[];
  /** People; a bot or an agent is never a sender. */
  senders: readonly string[];
};

/**
 * A person's stack: it captures the notifications a capture rule matches into
 * Noise, except those a release rule lets through.
 */
export type Stack = {
  id: string;
  name: string;
  capture: readonly StackRule[];
  release: readonly StackRule[];
  enabled: boolean;
};

/** A stack's rules, as the server stores them. */
export type StackRules = Pick<Stack, 'capture' | 'release'>;

/**
 * What the editor edits: one capture rule, and whether mentions and replies
 * still come through.
 */
export type StackDraft = {
  name: string;
  sources: readonly StackSource[];
  senders: readonly string[];
  /** Empty captures every kind. */
  kinds: readonly StackKind[];
  releaseMentions: boolean;
  releaseReplies: boolean;
};

/** A new stack lets mentions and replies in the reader's threads through. */
export const NEW_STACK_DRAFT: StackDraft = {
  name: '',
  sources: [],
  senders: [],
  kinds: [],
  releaseMentions: true,
  releaseReplies: true,
};

const EMPTY_RULE: StackRule = {
  sources: [],
  channelTypes: [],
  kinds: [],
  senders: [],
};

const releaseRule = (kind: StackKind): StackRule => ({
  ...EMPTY_RULE,
  kinds: [kind],
});

/** Whether a rule is exactly "this one kind, anywhere, from anyone". */
const releasesOnly = (rule: StackRule, kind: StackKind) =>
  rule.sources.length === 0 &&
  rule.channelTypes.length === 0 &&
  rule.senders.length === 0 &&
  rule.kinds.length === 1 &&
  rule.kinds[0] === kind;

export const sameSource = (a: StackSource, b: StackSource): boolean => {
  if (a.type === 'channelNameContains' || b.type === 'channelNameContains') {
    return (
      a.type === 'channelNameContains' &&
      b.type === 'channelNameContains' &&
      a.text.toLowerCase() === b.text.toLowerCase()
    );
  }
  return a.type === b.type && a.id === b.id;
};

/** The rules a draft stands for. */
export function rulesFromDraft(draft: StackDraft): StackRules {
  return {
    capture: [
      {
        ...EMPTY_RULE,
        sources: draft.sources,
        senders: draft.senders,
        kinds: draft.kinds,
      },
    ],
    release: [
      ...(draft.releaseMentions ? [releaseRule('mention')] : []),
      ...(draft.releaseReplies ? [releaseRule('reply')] : []),
    ],
  };
}

/**
 * A stack as the editor shows it, or undefined when its rules say more than
 * the editor can: several capture rules, a channel type, or a release rule
 * other than "mentions" and "replies". Saving such a stack from the editor
 * would drop what it cannot show.
 */
export function draftFromStack(stack: Stack): StackDraft | undefined {
  const [capture, ...moreCapture] = stack.capture;
  if (!capture || moreCapture.length > 0 || capture.channelTypes.length > 0) {
    return undefined;
  }
  const releaseMentions = stack.release.some((rule) =>
    releasesOnly(rule, 'mention')
  );
  const releaseReplies = stack.release.some((rule) =>
    releasesOnly(rule, 'reply')
  );
  const known = (releaseMentions ? 1 : 0) + (releaseReplies ? 1 : 0);
  if (stack.release.length !== known) return undefined;

  return {
    name: stack.name,
    sources: capture.sources,
    senders: capture.senders,
    kinds: capture.kinds,
    releaseMentions,
    releaseReplies,
  };
}

/** Why a draft cannot be saved yet. */
export type DraftProblem =
  /** It has no name. */
  | 'name'
  /** It names no place, person or kind, so it would capture everything. */
  | 'capture';

export function draftProblem(draft: StackDraft): DraftProblem | undefined {
  if (draft.name.trim() === '') return 'name';
  const setsACondition =
    draft.sources.length > 0 ||
    draft.senders.length > 0 ||
    draft.kinds.length > 0;
  return setsACondition ? undefined : 'capture';
}

/** The ids a draft names for one kind of entity. */
export function entityIds(
  draft: Pick<StackDraft, 'sources' | 'senders'>,
  kind: StackEntityKind
): string[] {
  if (kind === 'person') return [...draft.senders];
  return draft.sources.flatMap((source) =>
    source.type === kind ? [source.id] : []
  );
}

/** The draft with one kind of entity replaced by `ids`, order kept. */
export function withEntityIds<
  D extends Pick<StackDraft, 'sources' | 'senders'>,
>(draft: D, kind: StackEntityKind, ids: readonly string[]): D {
  if (kind === 'person') return { ...draft, senders: [...ids] };
  const others = draft.sources.filter((source) => source.type !== kind);
  const chosen = ids.map((id): StackSource => ({ type: kind, id }));
  return { ...draft, sources: [...others, ...chosen] };
}

/** Whether a stack's first capture rule names the channel. */
export function capturesChannel(stack: Stack, channelId: string): boolean {
  return (stack.capture[0]?.sources ?? []).some(
    (source) => source.type === 'channel' && source.id === channelId
  );
}

/**
 * Whether a capture rule matches the channel by its name, so the stack
 * captures it without naming it. A direct message has no name to match.
 */
export function capturesChannelName(
  stack: Stack,
  channelName: string
): boolean {
  const name = channelName.toLowerCase();
  return stack.capture.some((rule) =>
    rule.sources.some(
      (source) =>
        source.type === 'channelNameContains' &&
        name.includes(source.text.toLowerCase())
    )
  );
}

/**
 * The stack's capture rules with the channel added to, or taken out of, the
 * first one. A stack always has a capture rule.
 */
export function captureWithChannel(
  stack: Stack,
  channelId: string,
  captured: boolean
): StackRule[] {
  const [first = EMPTY_RULE, ...rest] = stack.capture;
  const others = first.sources.filter(
    (source) => !(source.type === 'channel' && source.id === channelId)
  );
  const sources: StackSource[] = captured
    ? [...others, { type: 'channel', id: channelId }]
    : others;
  return [{ ...first, sources }, ...rest];
}
