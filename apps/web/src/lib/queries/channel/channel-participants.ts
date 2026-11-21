import { fireAndForget } from '@core/util/fireAndForget';
import type { ChannelEntity } from '@entity';
import {
  type Mutation,
  useMutationState,
  useQuery,
} from '@tanstack/solid-query';
import {
  type Accessor,
  batch,
  createEffect,
  createMemo,
  createSignal,
  on,
  onCleanup,
} from 'solid-js';
import { match } from 'ts-pattern';
import { queryClient } from '../client';
import { createChannelDetailQuery } from './detail';
import {
  CHANNEL_PARTICIPANTS_MUTATION_GC_MS,
  CHANNEL_PARTICIPANTS_MUTATION_KEY,
  type ChannelParticipantsMutationVariables,
} from './participants';
import {
  channelParticipantsRestFallbackOptions,
  type ParticipantsFallbackReason,
  readParticipantsOnServer,
} from './participants-rest-fallback';
import type { ChannelParticipant } from './types';

type ParticipantChange = {
  id: number;
  kind: 'add' | 'remove';
  channelId: string;
  userIds: string[];
  submittedAt: number;
  settled: boolean;
};

/** Which read a channel's record came from. */
type RecordSource = 'graphql' | 'rest';

/** What a reader remembers about a succeeded change it shows. */
type SettledChange = {
  /** The record it was judged against, and that record's roster. */
  source: RecordSource;
  roster: string;
  /** Since when it shows. */
  since: number;
  /**
   * From when the server's answers count: once its time to show runs out, or
   * at once when the reader starts it over or its record changes after the
   * server said it holds.
   */
  checkFrom: number;
  /**
   * Answers count only from checks sent after this many had been: a check
   * sent earlier read the server before the reader started counting, even
   * one sent in the same millisecond or before the clock was set back.
   */
  checkAfter: number;
  /** Whether its record changed after the server said it holds, and the server is being asked again. */
  rechecking: boolean;
  /** Whether this reader showed it before its time to show ran out. */
  watched: boolean;
  /** Whether the server said it holds once that time ran out. */
  confirmed: boolean;
  /** The check whose answer said so (0 until one does). */
  confirmedBy: number;
  /**
   * People it no longer decides: a change here that finished later touched
   * them, or the server said it does not hold for them.
   */
  released: readonly string[];
};

/**
 * A question a reader asked the server about a channel once a succeeded
 * change's time to show ran out, at `at`, and its answer: who the server said
 * is in the channel, or undefined members if it did not say.
 */
type ServerQuestion = {
  channelId: string;
  seq: number;
  at: number;
  /** Which check it rode on, counted across every reader. */
  sent: number;
  answer?: { members: readonly string[] | undefined };
};

/** How many questions a reader keeps per channel. */
const QUESTIONS_KEPT = 8;

/** What the server says about a change, from the questions asked since its time to show ran out. */
type ServerSays =
  | { kind: 'unasked' }
  | { kind: 'waiting' }
  | { kind: 'failed' }
  | { kind: 'members'; members: ReadonlySet<string>; sent: number };

/** What one reader remembers about the changes it showed. */
type Overlay = {
  data: ChannelParticipant[] | undefined;
  /** Changes this reader saw in flight. */
  seenPending: ReadonlySet<number>;
  /**
   * When each succeeded change finished, as this reader saw it: a change that
   * finished later decides the people it touches.
   */
  finished: ReadonlyMap<number, number>;
  /** Succeeded changes still shown. */
  settled: ReadonlyMap<number, SettledChange>;
  /**
   * Succeeded changes a newer record has superseded, and which read that
   * record came from: never shown over that read again.
   */
  superseded: ReadonlyMap<number, RecordSource>;
  /** When the reader next needs to ask the server. */
  expiresAt: number | undefined;
  /** The check that question must come after (see `SettledChange.checkAfter`). */
  askAfter: number;
};

const EMPTY_OVERLAY: Overlay = {
  data: undefined,
  seenPending: new Set(),
  finished: new Map(),
  settled: new Map(),
  superseded: new Map(),
  expiresAt: undefined,
  askAfter: 0,
};

function selectChange(
  mutation: Mutation<unknown, Error, unknown, unknown>
): ParticipantChange | undefined {
  const { status, variables, submittedAt } = mutation.state;
  // A failed change shows nothing, which is its rollback.
  if (status !== 'pending' && status !== 'success') return undefined;
  const vars = variables as ChannelParticipantsMutationVariables | undefined;
  if (!vars) return undefined;
  const kind = mutation.options.mutationKey?.at(-1);
  if (kind !== 'add' && kind !== 'remove') return undefined;
  return {
    id: mutation.mutationId,
    kind,
    channelId: vars.channelId,
    userIds: vars.participants,
    submittedAt,
    settled: status === 'success',
  };
}

/** Who is in a record, with their roles and join times: a rejoin changes it. */
function rosterOf(participants: readonly ChannelParticipant[]) {
  return participants
    .map(
      (participant) =>
        `${participant.user_id}\u0000${participant.role}\u0000${Date.parse(participant.joined_at)}`
    )
    .sort()
    .join('\n');
}

function holdsFor(
  kind: ParticipantChange['kind'],
  userId: string,
  present: ReadonlySet<string>
) {
  return kind === 'add' ? present.has(userId) : !present.has(userId);
}

function recordShows(
  change: ParticipantChange,
  participants: readonly ChannelParticipant[]
) {
  const present = new Set(
    participants.map((participant) => participant.user_id)
  );
  return change.userIds.every((userId) =>
    holdsFor(change.kind, userId, present)
  );
}

function applyChange(
  channelId: string,
  participants: ChannelParticipant[],
  change: ParticipantChange
): ChannelParticipant[] {
  if (change.kind === 'remove') {
    const removed = new Set(change.userIds);
    return participants.filter(
      (participant) => !removed.has(participant.user_id)
    );
  }
  const present = new Set(
    participants.map((participant) => participant.user_id)
  );
  const joinedAt = new Date(change.submittedAt).toISOString();
  const added = change.userIds
    .filter((userId) => !present.has(userId))
    .map(
      (userId): ChannelParticipant => ({
        channel_id: channelId,
        user_id: userId,
        role: 'member',
        joined_at: joinedAt,
        left_at: null,
      })
    );
  return added.length ? [...participants, ...added] : participants;
}

/** Orders succeeded changes by when they finished, as this reader saw them finish. */
function byFinish(finished: ReadonlyMap<number, number>) {
  const at = (change: ParticipantChange) =>
    finished.get(change.id) ?? change.submittedAt;
  return (a: ParticipantChange, b: ParticipantChange) =>
    at(a) - at(b) || a.id - b.id;
}

// A change here that finished later decides the people it touches, even once
// it settles against a record that already matched it, as the server applied
// it last. One still in flight shows over this change, which comes back if it
// fails.
function released(
  change: ParticipantChange,
  changes: readonly (ParticipantChange | undefined)[],
  finished: ReadonlyMap<number, number>,
  earlier: readonly string[]
): readonly string[] {
  const touched = new Set(earlier);
  const order = byFinish(finished);
  for (const later of changes) {
    if (!later?.settled || later.channelId !== change.channelId) continue;
    if (order(later, change) <= 0) continue;
    for (const userId of later.userIds)
      if (change.userIds.includes(userId)) touched.add(userId);
  }
  return touched.size === earlier.length ? earlier : [...touched];
}

/** The part of a change still its own to show. */
function stillShown(
  change: ParticipantChange,
  gone: readonly string[]
): ParticipantChange {
  if (!gone.length) return change;
  return {
    ...change,
    userIds: change.userIds.filter((userId) => !gone.includes(userId)),
  };
}

/**
 * Adds a question, keeping the channel's latest few answers, those that said
 * nothing first to go. A question still waiting is never dropped: its answer
 * may be the only one that decides (each waits ten seconds at most). Neither
 * is an answer that named members while newer ones said nothing, which would
 * hand the decision to an older answer.
 */
function withQuestion(
  questions: readonly ServerQuestion[],
  question: ServerQuestion
): readonly ServerQuestion[] {
  const answered = questions.filter(
    (q) => q.channelId === question.channelId && q.answer
  );
  const saidNothing = answered.filter((q) => !q.answer?.members);
  const named = answered.filter((q) => q.answer?.members);
  const dropped = new Set(
    [...saidNothing, ...named].slice(
      0,
      Math.max(0, answered.length - (QUESTIONS_KEPT - 1))
    )
  );
  return [...questions.filter((q) => !dropped.has(q)), question];
}

/** Records the answer to one question; answers to forgotten ones change nothing. */
function withAnswer(
  questions: readonly ServerQuestion[],
  seq: number,
  members: readonly string[] | undefined
): readonly ServerQuestion[] {
  return questions.map((q) =>
    q.seq === seq ? { ...q, answer: { members } } : q
  );
}

/**
 * What the server says, from the questions asked since `expires` on checks
 * sent after `after`: the newest that answered decides, unless a newer one is
 * still waiting; a question the server did not answer gives way to an older
 * one.
 */
function serverSays(
  questions: readonly ServerQuestion[],
  channelId: string,
  expires: number,
  after: number
): ServerSays {
  const asked = questions
    .filter(
      (q) => q.channelId === channelId && q.at >= expires && q.sent > after
    )
    .sort((a, b) => b.seq - a.seq);
  if (!asked.length) return { kind: 'unasked' };
  for (const question of asked) {
    if (!question.answer) return { kind: 'waiting' };
    const { members } = question.answer;
    if (members)
      return {
        kind: 'members',
        members: new Set(members),
        sent: question.sent,
      };
  }
  return { kind: 'failed' };
}

/**
 * Who the answer naming members from the newest check sent after `after` says
 * is in the channel, whatever newer checks are still waiting or failed. Checks
 * are ordered by when they were sent, so an older check that answers late
 * cannot undo a newer one.
 */
function latestMembers(
  questions: readonly ServerQuestion[],
  channelId: string,
  after: number
): ReadonlySet<string> | undefined {
  const [newest] = questions
    .filter(
      (q) => q.channelId === channelId && q.sent > after && q.answer?.members
    )
    .sort((a, b) => b.sent - a.sent || b.seq - a.seq);
  const members = newest?.answer?.members;
  return members ? new Set(members) : undefined;
}

/** How long a channel's first by-id read may go unanswered before its reader asks REST too. */
export const CHANNEL_READ_SLOW_MS = 3_000;

function fallbackReason(
  failed: boolean,
  slow: boolean
): ParticipantsFallbackReason {
  if (failed) return 'channel read failed';
  return slow ? 'channel read slow' : 'channel not in soup';
}

/** A read of who the server says is in a channel, when it was sent, and how many had been sent by then. */
type ServerCheck = {
  at: number;
  sent: number;
  members: Promise<readonly string[] | undefined>;
};

/** The latest server check, per query client and channel. */
const SERVER_CHECKS = new WeakMap<object, Map<string, ServerCheck>>();

/** How many server checks this page has sent, which only grows (unlike the clock). */
const SERVER_CHECKS_SENT = { count: 0 };

/** Who the server says is in the channel; a read that threw says nothing. */
async function membersOnServer(channelId: string) {
  try {
    return await readParticipantsOnServer(channelId);
  } catch {
    return undefined;
  }
}

/**
 * The read a question rides on: the channel's latest, in flight or answered,
 * when it was sent no earlier than `notBefore` and after check `after`, so
 * the readers mounted on a channel (its view, header, roster and request rows)
 * ask once; otherwise a new one.
 */
function serverCheck(
  channelId: string,
  notBefore: number,
  after: number
): ServerCheck {
  let checks = SERVER_CHECKS.get(queryClient);
  if (!checks) {
    checks = new Map();
    SERVER_CHECKS.set(queryClient, checks);
  }
  const latest = checks.get(channelId);
  if (latest && latest.at >= notBefore && latest.sent > after) return latest;
  SERVER_CHECKS_SENT.count += 1;
  const check = {
    at: Date.now(),
    sent: SERVER_CHECKS_SENT.count,
    members: membersOnServer(channelId),
  };
  checks.set(channelId, check);
  return check;
}

/** Hands a check's answer to the question that asked it. */
async function answerWith(
  check: ServerCheck,
  answered: (members: readonly string[] | undefined) => void
) {
  answered(await check.members);
}

/** What a reader judges a succeeded change against. */
type SettledContext = {
  changes: readonly (ParticipantChange | undefined)[];
  participants: readonly ChannelParticipant[];
  source: RecordSource;
  roster: string;
  previous: Overlay;
  finished: ReadonlyMap<number, number>;
  now: number;
  questions: readonly ServerQuestion[];
  /** How many server checks had been sent. */
  sent: number;
};

/** A succeeded change that still shows: what the reader remembers, who it shows, and when to ask next. */
type Judged = {
  seen: SettledChange;
  shown: ParticipantChange;
  askAt: number | undefined;
};

const showsUntil = (seen: SettledChange) =>
  seen.since + CHANNEL_PARTICIPANTS_MUTATION_GC_MS;

/**
 * How a reader first records a succeeded change it shows. One it saw in
 * flight, or showed over another read, shows from now; one that had
 * already succeeded when the reader opened shows from its submission.
 */
function firstSeen(
  change: ParticipantChange,
  context: SettledContext,
  restarted: boolean
): SettledChange {
  const fresh = restarted || context.previous.seenPending.has(change.id);
  const since = fresh ? context.now : change.submittedAt;
  return {
    source: context.source,
    roster: context.roster,
    since,
    // A change started over against another read asks the server at once:
    // that read can be older than the change, or newer than someone else's.
    checkFrom: restarted
      ? context.now
      : since + CHANNEL_PARTICIPANTS_MUTATION_GC_MS,
    checkAfter: context.sent,
    rechecking: false,
    watched: context.now < since + CHANNEL_PARTICIPANTS_MUTATION_GC_MS,
    confirmed: false,
    confirmedBy: 0,
    released: [],
  };
}

/**
 * Once a change's time to show runs out, it keeps showing only if this reader
 * showed it all that time and the server, asked since then, says it holds,
 * for the people it says so; until the server answers, it waits. A confirmed
 * change keeps showing unless a later answer says otherwise. A change asked
 * about early (started over) keeps its time to show when the server does not
 * answer, and asks again once it runs out. While the reader rechecks a
 * confirmed change, the newest check answered since the one that confirmed it
 * decides who shows until the recheck answers, so record changes that keep
 * coming cannot hold a refutation off, and a newer check can still bring
 * someone back; the recheck's own answer then decides for good. If it fails,
 * the newest answer decides for good.
 */
function afterExpiry(
  judgedShown: ParticipantChange,
  judgedSeen: SettledChange,
  expires: number,
  context: SettledContext
): Judged | undefined {
  if (!judgedSeen.watched) return undefined;
  const [shown, seen] = [judgedShown, judgedSeen];
  const says = serverSays(
    context.questions,
    shown.channelId,
    expires,
    seen.checkAfter
  );
  if (seen.rechecking && says.kind !== 'members')
    return whileRechecking(shown, seen, expires, says, context);
  const asking = !seen.confirmed || seen.rechecking;
  const unanswered = (): Judged | undefined => {
    if (seen.confirmed) return { seen, shown, askAt: undefined };
    const until = showsUntil(seen);
    if (context.now < until) return { seen, shown, askAt: until };
    // Asked early: it asks again, with a check sent once its time ran out.
    return expires < until
      ? afterExpiry(shown, seen, until, context)
      : undefined;
  };
  return (
    match(says)
      .with({ kind: 'unasked' }, () => ({
        seen,
        shown,
        askAt: asking ? expires : undefined,
      }))
      .with({ kind: 'waiting' }, () => ({ seen, shown, askAt: undefined }))
      .with({ kind: 'failed' }, unanswered)
      .with({ kind: 'members' }, ({ members, sent }) => {
        const refuted = shown.userIds.filter(
          (userId) => !holdsFor(shown.kind, userId, members)
        );
        if (refuted.length === shown.userIds.length) return undefined;
        return {
          seen: {
            ...seen,
            confirmed: true,
            confirmedBy: sent,
            rechecking: false,
            released: [...seen.released, ...refuted],
          },
          shown: stillShown(shown, refuted),
          askAt: undefined,
        };
      })
      // A judgment this build does not know stops showing the change.
      .exhaustive(() => undefined)
  );
}

/**
 * A confirmed change whose recheck has not answered: the newest answer decides
 * who shows. A failed recheck asks once more when the time to show runs out
 * after the record changed, as a change asked about early does: a reader that
 * was on another channel missed checks another reader still waits on. If that
 * fails too, the newest answer decides for good, once every check sent since
 * the confirmation has answered: one still out may be newer than it.
 */
function whileRechecking(
  shown: ParticipantChange,
  seen: SettledChange,
  expires: number,
  says: ServerSays,
  context: SettledContext
): Judged | undefined {
  const members = latestMembers(
    context.questions,
    shown.channelId,
    seen.confirmedBy
  );
  const refuted = members
    ? shown.userIds.filter((userId) => !holdsFor(shown.kind, userId, members))
    : [];
  const stillOut = context.questions.some(
    (q) =>
      q.channelId === shown.channelId && q.sent > seen.confirmedBy && !q.answer
  );
  if (says.kind !== 'failed' || stillOut)
    return {
      seen,
      shown: stillShown(shown, refuted),
      askAt: says.kind === 'unasked' ? expires : undefined,
    };
  const retryAt = seen.checkFrom + CHANNEL_PARTICIPANTS_MUTATION_GC_MS;
  if (expires < retryAt)
    return context.now < retryAt
      ? { seen, shown: stillShown(shown, refuted), askAt: retryAt }
      : afterExpiry(shown, seen, retryAt, context);
  if (refuted.length === shown.userIds.length) return undefined;
  return {
    seen: { ...seen, released: [...seen.released, ...refuted] },
    shown: stillShown(shown, refuted),
    askAt: undefined,
  };
}

/**
 * A record that changes otherwise supersedes a change (someone changed it
 * since), unless the server already said the change holds: then the record can
 * be one read before the change, so the reader asks the server again, with a
 * check sent from now on, and keeps showing it until the server answers. Each
 * change while it asks asks again.
 */
function recheckOnChange(
  seen: SettledChange,
  context: SettledContext
): Partial<SettledChange> {
  if (seen.roster === context.roster) return {};
  if (!seen.confirmed && !seen.rechecking) return {};
  return {
    roster: context.roster,
    rechecking: true,
    checkFrom: context.now,
    checkAfter: context.sent,
  };
}

/**
 * Whether a succeeded change still shows, and how: undefined once something
 * has superseded it.
 */
function judgeSettled(
  change: ParticipantChange,
  context: SettledContext
): Judged | undefined {
  const { previous, now, source } = context;
  const supersededOver = previous.superseded.get(change.id);
  if (supersededOver === source) return undefined;
  const kept = previous.settled.get(change.id);
  const earlier = kept?.source === source ? kept : undefined;
  // A change judged against the other read starts over against this one.
  const restarted = !earlier && (!!kept || supersededOver !== undefined);
  const first = earlier ?? firstSeen(change, context, restarted);
  const seen = {
    ...first,
    ...recheckOnChange(first, context),
    released: released(
      change,
      context.changes,
      context.finished,
      first.released
    ),
  };
  const shown = stillShown(change, seen.released);
  if (
    seen.roster !== context.roster ||
    !shown.userIds.length ||
    recordShows(shown, context.participants)
  )
    return undefined;
  const expires = seen.checkFrom;
  if (now < expires) return { seen, shown, askAt: expires };
  return afterExpiry(shown, seen, expires, context);
}

/** When each succeeded change of the channel finished, as this reader saw it. */
function finishTimes(
  channelId: string,
  changes: readonly (ParticipantChange | undefined)[],
  previous: Overlay,
  now: number
) {
  const finished = new Map<number, number>();
  for (const change of changes) {
    if (!change?.settled) continue;
    const known = previous.finished.get(change.id);
    if (known !== undefined) finished.set(change.id, known);
    else if (change.channelId === channelId)
      finished.set(
        change.id,
        previous.seenPending.has(change.id) ? now : change.submittedAt
      );
  }
  return finished;
}

/**
 * Shows the channel's adds and removes over its record: succeeded ones in the
 * order they finished, until the record shows them, the record changes
 * otherwise (someone changed it since), a change here that finished later
 * takes over the same people, or the change has shown for a while without its
 * soup update arriving and the server, asked then, does not say it still
 * holds; then the ones in flight.
 */
export function overlayParticipantChanges(
  channelId: string,
  record:
    | { participants: ChannelParticipant[]; source: RecordSource }
    | undefined,
  changes: readonly (ParticipantChange | undefined)[],
  previous: Overlay,
  now: number,
  questions: readonly ServerQuestion[] = [],
  sent = 0
): Overlay {
  if (!record) return { ...previous, data: undefined, expiresAt: undefined };
  const { participants, source } = record;
  const seenPending = new Set<number>();
  const settled = new Map<number, SettledChange>();
  const superseded = new Map<number, RecordSource>();
  const finished = finishTimes(channelId, changes, previous, now);
  const context: SettledContext = {
    changes,
    participants,
    source,
    roster: rosterOf(participants),
    previous,
    finished,
    now,
    questions,
    sent,
  };
  const asks: { at: number; after: number }[] = [];
  let data = participants;
  const own: ParticipantChange[] = [];
  for (const change of changes) {
    if (!change) continue;
    if (change.channelId === channelId) {
      own.push(change);
      continue;
    }
    // Kept for when the reader returns to that channel.
    if (previous.seenPending.has(change.id)) seenPending.add(change.id);
    const over = previous.superseded.get(change.id);
    if (over) superseded.set(change.id, over);
    const earlier = previous.settled.get(change.id);
    if (earlier) settled.set(change.id, earlier);
  }
  const inFlight = own.filter((change) => !change.settled);
  for (const change of inFlight) seenPending.add(change.id);
  const succeeded = own
    .filter((change) => change.settled)
    .sort(byFinish(finished));
  for (const change of succeeded) {
    const judged = judgeSettled(change, context);
    if (!judged) {
      superseded.set(change.id, source);
      continue;
    }
    settled.set(change.id, judged.seen);
    if (judged.askAt !== undefined)
      asks.push({ at: judged.askAt, after: judged.seen.checkAfter });
    data = applyChange(channelId, data, judged.shown);
  }
  for (const change of inFlight) data = applyChange(channelId, data, change);
  // The next question, and the check it must come after: that of the changes
  // due then, so a change due later cannot keep a due one from sharing a check.
  const expiresAt = asks.length
    ? Math.min(...asks.map((ask) => ask.at))
    : undefined;
  const askAfter = Math.max(
    0,
    ...asks.filter((ask) => ask.at === expiresAt).map((ask) => ask.after)
  );
  return {
    data,
    seenPending,
    finished,
    settled,
    superseded,
    expiresAt,
    askAfter,
  };
}

/**
 * The active participants of a channel, from its GraphQL soup record. Shares
 * the open channel's by-id request and stays current through soup updates.
 * Adds and removes in flight show until the record catches up.
 */
export function useChannelParticipantsQuery(channelId: Accessor<string>) {
  // The id alone, so timers below restart only when it changes.
  const openId = createMemo(() => channelId());
  const query = createChannelDetailQuery(
    channelId,
    () => !!channelId(),
    'cache-first'
  );
  const changes = useMutationState(
    () => ({
      filters: { mutationKey: CHANNEL_PARTICIPANTS_MUTATION_KEY },
      select: selectChange,
    }),
    () => queryClient
  );
  // What the channel's by-id read last answered for the open channel.
  const answered = createMemo<
    { channelId: string; hasChannel: boolean } | undefined
  >((previous) => {
    if (query.isPending) return undefined;
    const id = channelId();
    if (query.error) return previous?.channelId === id ? previous : undefined;
    const hasChannel = !!query.data?.entities.some(
      (entity) => entity.type === 'channel' && entity.id === id
    );
    return { channelId: id, hasChannel };
  });
  // The soup read leaves out public channels the viewer has not joined, which
  // REST lets them read, so a read that answered without the channel asks
  // REST, and keeps asking through failed refreshes. So does a read that
  // failed before it ever answered, since nothing retries it; REST checks
  // access itself, as it did when it was the only reader. A failed refresh of
  // a channel the read returned keeps its roster (see `confirmed`).
  // A first read still unanswered after a while asks REST too, as main's
  // reader did on every open: the channel's by-id read can wait behind a busy
  // cache or connection long after REST would have answered.
  const [slowChannel, setSlowChannel] = createSignal<string>();
  const pendingChannel = createMemo(() =>
    query.isPending ? openId() || undefined : undefined
  );
  createEffect(
    on(pendingChannel, (pending) => {
      setSlowChannel(undefined);
      if (!pending) return;
      const timer = setTimeout(
        () => setSlowChannel(pending),
        CHANNEL_READ_SLOW_MS
      );
      onCleanup(() => clearTimeout(timer));
    })
  );
  const readSlow = () => query.isPending && slowChannel() === openId();
  const missesChannel = () => {
    if (!channelId()) return false;
    if (query.isPending) return readSlow();
    return answered()?.hasChannel !== true;
  };
  const fallback = useQuery(() =>
    channelParticipantsRestFallbackOptions(
      channelId(),
      missesChannel(),
      fallbackReason(!!query.error, readSlow())
    )
  );
  const confirmed = createMemo<
    | {
        channelId: string;
        participants: ChannelParticipant[] | undefined;
        source: RecordSource;
      }
    | undefined
  >((previous) => {
    if (query.isPending && !readSlow()) return undefined;
    const id = channelId();
    if (missesChannel()) {
      // A failed REST refetch keeps its last participants. Rows still from the
      // previous channel's REST read never show for this one.
      const rows = fallback.isPending ? undefined : fallback.data;
      const own = rows?.every(
        (participant) =>
          participant.channel_id.toLowerCase() === id.toLowerCase()
      );
      return {
        channelId: id,
        participants: own ? rows : undefined,
        source: 'rest',
      };
    }
    // A failed refresh keeps the participants on screen.
    if (query.error)
      return previous?.channelId === id
        ? previous
        : { channelId: id, participants: undefined, source: 'graphql' };
    const entity = query.data?.entities.find(
      (entity): entity is ChannelEntity =>
        entity.type === 'channel' && entity.id === id
    );
    return {
      channelId: id,
      participants: entity?.participants,
      source: 'graphql',
    };
  });
  // Ticks when a succeeded change's time to show runs out.
  const [tick, setTick] = createSignal(0);
  // What the reader asked the server about each channel, once a succeeded
  // change's time to show ran out, and what it answered.
  const [questions, setQuestions] = createSignal<readonly ServerQuestion[]>([]);
  let asks = 0;
  const ask = (channel: string, notBefore: number, after: number) => {
    const check = serverCheck(channel, notBefore, after);
    asks += 1;
    const seq = asks;
    batch(() => {
      setQuestions((all) =>
        withQuestion(all, {
          channelId: channel,
          seq,
          at: check.at,
          sent: check.sent,
        })
      );
      setTick((value) => value + 1);
    });
    fireAndForget(
      answerWith(check, (members) =>
        setQuestions((all) => withAnswer(all, seq, members))
      ),
      'channel participants server check'
    );
  };
  const overlay = createMemo<Overlay>((previous) => {
    tick();
    const record = confirmed();
    return overlayParticipantChanges(
      channelId(),
      record?.participants
        ? { participants: record.participants, source: record.source }
        : undefined,
      changes(),
      previous,
      Date.now(),
      questions(),
      SERVER_CHECKS_SENT.count
    );
  }, EMPTY_OVERLAY);
  // When a succeeded change's time to show runs out, the reader asks the
  // server whether it holds, and shows it until the server answers. (A memo, so
  // a recomputed overlay with the same expiry neither restarts the timer nor
  // asks again.)
  const expiresAt = createMemo(() => overlay().expiresAt);
  const askAfter = createMemo(() => overlay().askAfter);
  createEffect(
    on([openId, expiresAt, askAfter], ([current, expires, after]) => {
      if (expires === undefined) return;
      // A clock set back wakes the timer early: it waits out the rest, since
      // only an answer asked for once the time ran out counts.
      let timer: ReturnType<typeof setTimeout> | undefined;
      const wake = () => {
        const wait = expires - Date.now();
        if (wait > 0) timer = setTimeout(wake, wait);
        else ask(current, expires, after);
      };
      timer = setTimeout(wake, Math.max(0, expires - Date.now()));
      onCleanup(() => clearTimeout(timer));
    })
  );
  const data = () => overlay().data;
  return {
    get isPending() {
      return (
        (query.isPending && !readSlow()) ||
        (missesChannel() && fallback.isPending)
      );
    },
    get isLoading() {
      return (
        (query.isLoading && !readSlow()) ||
        (missesChannel() && fallback.isLoading)
      );
    },
    /** The channel's record arrived; a channel the viewer can't read has none. */
    get isSuccess() {
      return (!query.isPending || readSlow()) && data() !== undefined;
    },
    get data() {
      return data();
    },
  };
}
