/**
 * Following a live agent session's log, and handing what it folds to whoever
 * has the channel open.
 *
 * The websocket delivers appended log frames (see
 * `@core/agent-fold/stream-protocol`), one at a time, in exactly the shape
 * `GET /agent-sessions/channel/{id}/log` serves them. This routes them into
 * the worker's fold machine for that session and fans the resulting messages
 * out to the channel views watching it.
 *
 * # The seam
 *
 * A channel that opens mid-session has to do two things that overlap: fetch
 * the log so far, and start following what comes after. The fetch is a
 * snapshot taken at an instant the client cannot name, and frames keep
 * arriving while it is in flight — so the two naive orderings both lose.
 * Subscribing after the fetch drops everything that happened during it.
 * Subscribing before it and replaying blindly folds the overlap twice, which
 * duplicates prose *inside* a message rather than duplicating a message,
 * because the fold appends text chunks in place.
 *
 * So: buffer from before the fetch is issued, then align. The buffer and the
 * snapshot are runs of the same total order and the buffer starts at or
 * before the snapshot's end, so the longest prefix of the buffer that is also
 * a suffix of the snapshot *is* the overlap. Drop it, replay the rest. Frames
 * compare by their serialized form, which is sound precisely because the
 * streamed and fetched shapes are byte-identical — that is what the wire
 * contract is for.
 *
 * # One machine per session, not per view
 *
 * A split view can have the same channel open twice. Both views fetch and
 * both want to follow, but there is only one log, so there is one machine:
 * the first view to arrive opens it from its snapshot, and later ones read
 * what it has folded rather than reopening it — reopening would discard every
 * frame folded since the later view's own snapshot was taken. The machine
 * closes when the last view stops watching.
 */

import {
  closeSession,
  openSession,
  pushSessionEntries,
  sessionMessages,
} from '@core/agent-fold/client';
import {
  type AgentSessionLogEvent,
  entryOf,
} from '@core/agent-fold/stream-protocol';
import type { FoldedMessage } from '@core/agent-fold/types';
import type { AgentSessionLogEntryDto } from '@service-storage/generated/schemas/agentSessionLogEntryDto';
import { ensureAgentSessionPlaceholder } from './agent-session-placeholders';

/** A channel view that wants the messages a live frame derives. */
export type FoldedMessageSink = (messages: FoldedMessage[]) => void;

type ChannelStream = {
  /**
   * Frames held because no machine is open for them yet — the channel is
   * still fetching the log they belong after.
   */
  buffered: AgentSessionLogEntryDto[];
  /** The session whose machine is open, once one is. */
  session?: string;
  /** The views to hand folded messages to. */
  sinks: Set<FoldedMessageSink>;
  /**
   * How many readers have begun and not yet finished.
   *
   * Not `sinks.size`: a reader counts from before it knows whether the
   * channel even has a session, which is the whole window the buffer exists
   * for. Every {@link beginAgentSessionStream} is answered by exactly one
   * {@link abandonAgentSessionStream} or one `unfollow`.
   */
  readers: number;
};

const streams = new Map<string, ChannelStream>();

/**
 * Start holding a channel's frames.
 *
 * **Call this before issuing the log fetch**, not after: everything in
 * between is a frame the snapshot may or may not contain, and only a buffered
 * frame can be aligned against it. A frame that arrives after this and before
 * {@link followAgentSession} is kept; one that arrives before it is gone.
 */
export function beginAgentSessionStream(channelId: string): void {
  // A second view of the same channel, or a refetch of one already following:
  // the buffer and the open machine belong to the channel, not to whoever
  // asked for them first.
  const stream = streams.get(channelId) ?? {
    buffered: [],
    sinks: new Set<FoldedMessageSink>(),
    readers: 0,
  };
  stream.readers += 1;
  streams.set(channelId, stream);
}

/**
 * Give up on a channel without following it — it has no agent session, or its
 * log could not be fetched.
 */
export function abandonAgentSessionStream(channelId: string): void {
  const stream = streams.get(channelId);
  if (!stream) return;
  stream.readers -= 1;
  release(channelId, stream);
}

/** Drop a channel's buffer and its session's machine once no reader is left. */
function release(channelId: string, stream: ChannelStream): void {
  if (stream.readers > 0) return;
  streams.delete(channelId);
  // The machine is only holding memory now. The next reader fetches the log
  // again and opens a fresh one.
  if (stream.session) closeSession(stream.session);
}

/**
 * Follow a session whose log has just been fetched.
 *
 * Answers with the session's messages as the fold has them *now* — which for
 * a session someone else is already following is ahead of `fetched`, not
 * equal to it. `sink` is called with the messages a frame changed, every time
 * one does.
 *
 * Returns a function that stops following.
 */
export async function followAgentSession(args: {
  channelId: string;
  sessionId: string;
  fetched: AgentSessionLogEntryDto[];
  sink: FoldedMessageSink;
}): Promise<{ messages: FoldedMessage[]; unfollow: () => void }> {
  const { channelId, sessionId, fetched, sink } = args;
  const stream = streams.get(channelId);
  if (!stream) {
    throw new Error(
      `followAgentSession without beginAgentSessionStream for ${channelId}`
    );
  }

  const alreadyOpen = stream.session === sessionId;
  const messages = alreadyOpen
    ? await sessionMessages(sessionId)
    : await openSession(sessionId, fetched);

  // Only now, so a frame arriving during the open above is buffered rather
  // than pushed into a machine that is about to be replaced by it.
  stream.session = sessionId;
  stream.sinks.add(sink);

  const replay = alreadyOpen
    ? // Somebody else's machine is already past these.
      []
    : dropOverlap(fetched, stream.buffered);
  stream.buffered = [];
  if (replay.length > 0) {
    console.info('[agent-fold] replaying frames buffered during the fetch', {
      channelId,
      frames: replay.length,
    });
    push(channelId, sessionId, replay);
  }

  return {
    messages,
    unfollow: () => {
      stream.sinks.delete(sink);
      stream.readers -= 1;
      release(channelId, stream);
    },
  };
}

/**
 * Fold one appended frame, or hold it until there is a machine to fold it
 * into.
 *
 * A frame for a channel nobody has open is dropped: it is already in the log
 * the next reader fetches.
 */
export function handleAgentSessionLog(event: AgentSessionLogEvent): void {
  const stream = streams.get(event.channelId);
  if (!stream) {
    // The common miss: no channel open for this session, which is ordinary.
    // Logged anyway while streaming is new, because "the event arrived and
    // nobody was listening" and "no event arrived" look identical otherwise.
    console.debug('[agent-fold] frame for a channel with no open stream', {
      channelId: event.channelId,
      open: [...streams.keys()],
    });
    return;
  }

  const entry = entryOf(event);
  if (!stream.session) {
    stream.buffered.push(entry);
    console.debug('[agent-fold] frame buffered during catch-up', {
      channelId: event.channelId,
      buffered: stream.buffered.length,
    });
    return;
  }
  push(event.channelId, stream.session, [entry]);
}

/**
 * Fold frames and publish what changed.
 *
 * Not awaited by callers, and it does not need to be: `pushSessionEntries`
 * posts to the worker synchronously, the worker serves requests in the order
 * it received them, and replies come back in that order — so frames reach the
 * machine, and their results reach the sinks, in log order.
 */
function push(
  channelId: string,
  sessionId: string,
  entries: AgentSessionLogEntryDto[]
): void {
  void pushSessionEntries(sessionId, entries)
    .then((changes) => {
      const stream = streams.get(channelId);
      if (!stream || changes.length === 0) return;

      console.debug('[agent-fold] live frames folded', {
        channelId,
        frames: entries.length,
        changed: changes.map((change) => ({
          kind: change.kind,
          id: change.message.agentSessionMessageId,
        })),
        sinks: stream.sinks.size,
      });

      // Sinks first, rows second, and the order matters: a placeholder row
      // renders by looking its folded message up, so a row that appears
      // before the message is a row that renders empty and warns about it.
      const messages = changes.map((change) => change.message);
      for (const sink of stream.sinks) sink(messages);

      // A message the fold has just derived has no comms row yet, so one is
      // synthesized here rather than per sink: the row lives in the shared
      // channel cache and every view of the channel reads the same one.
      for (const change of changes) {
        if (change.kind === 'new') {
          void ensureAgentSessionPlaceholder(channelId, change.message);
        }
      }
    })
    .catch((error: unknown) => {
      // A frame that cannot be folded costs this channel its liveness until
      // it is reopened, which is much milder than tearing the view down.
      console.error('[agent-fold] live frame could not be folded', error);
    });
}

/**
 * The buffered frames the snapshot does not already contain.
 *
 * The longest prefix of `buffered` that is also a suffix of `fetched` is the
 * overlap — see the module docs. Longest rather than shortest because the
 * alignment is genuinely ambiguous when a session emits the same frame twice
 * running, and dropping a frame the fold has already seen costs a redraw,
 * while folding one twice corrupts the message it lands in.
 *
 * Exported for its own test: it is the one part of the seam that is a pure
 * function of two logs, and the one whose failure is silent — a fold that has
 * quietly folded a frame twice still renders.
 */
export function dropOverlap(
  fetched: AgentSessionLogEntryDto[],
  buffered: AgentSessionLogEntryDto[]
): AgentSessionLogEntryDto[] {
  if (buffered.length === 0 || fetched.length === 0) return buffered;

  const held = buffered.map((entry) => JSON.stringify(entry));
  const tail = fetched
    .slice(-held.length)
    .map((entry) => JSON.stringify(entry));

  for (
    let overlap = Math.min(tail.length, held.length);
    overlap > 0;
    overlap--
  ) {
    const from = tail.length - overlap;
    if (tail.slice(from).every((frame, i) => frame === held[i])) {
      return buffered.slice(overlap);
    }
  }

  return buffered;
}
