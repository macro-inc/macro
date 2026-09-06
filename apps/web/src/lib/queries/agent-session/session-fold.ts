import {
  closeSession,
  openSession,
  pushSessionEntries,
  sessionMessages,
} from '@core/agent-fold/client';
import type {
  FoldedMessage,
  SessionMetadata,
} from '@service-agent-fold/generated/types';
import { agentHarnessServiceClient } from '@service-agent-harness/client';
import type {
  AgentSessionLogEntryDto,
  SessionBot,
} from '@service-agent-harness/generated/schemas';
import { type AgentSessionLogEvent, entryOf } from './realtime-protocol';

/** Receives the folded messages changed by appended frames. */
export type FoldedMessageSink = (messages: FoldedMessage[]) => void;

/** Receives the session metadata whenever a frame changes it (latest-wins). */
export type SessionMetadataSink = (metadata: SessionMetadata) => void;

/** Receives raw realtime frames for one session. */
export type AgentSessionLogSink = (event: AgentSessionLogEvent) => void;

type SessionState = {
  agentSessionId: string;
  bot?: SessionBot;
  buffered: AgentSessionLogEntryDto[];
  foldedSinks: Set<FoldedMessageSink>;
  replacementSinks: Set<FoldedMessageSink>;
  metadataSinks: Set<SessionMetadataSink>;
  opening?: Promise<void>;
  ready: boolean;
  references: number;
};

const sessions = new Map<string, SessionState>();
const rawSinks = new Map<string, Set<AgentSessionLogSink>>();

/** Follow raw realtime log frames for one session. */
export function subscribeAgentSessionLog(
  agentSessionId: string,
  sink: AgentSessionLogSink
): () => void {
  const sinks = rawSinks.get(agentSessionId) ?? new Set<AgentSessionLogSink>();
  sinks.add(sink);
  rawSinks.set(agentSessionId, sinks);

  return () => {
    sinks.delete(sink);
    if (sinks.size === 0) rawSinks.delete(agentSessionId);
  };
}

/**
 * Acquire the shared live fold for a session.
 *
 * The first acquisition starts buffering before fetching the persisted log.
 * Concurrent acquisitions share that catch-up and worker machine. Call the
 * returned `release` once per successful acquisition.
 */
export async function acquireAgentSessionFold(args: {
  agentSessionId: string;
  onChange?: FoldedMessageSink;
  onReplace?: FoldedMessageSink;
  onMetadata?: SessionMetadataSink;
}): Promise<{
  bot: SessionBot;
  messages: FoldedMessage[];
  metadata: SessionMetadata;
  release: () => void;
}> {
  const { agentSessionId, onChange, onReplace, onMetadata } = args;
  const state = sessions.get(agentSessionId) ?? {
    agentSessionId,
    buffered: [],
    foldedSinks: new Set<FoldedMessageSink>(),
    replacementSinks: new Set<FoldedMessageSink>(),
    metadataSinks: new Set<SessionMetadataSink>(),
    ready: false,
    references: 0,
  };
  state.references += 1;
  sessions.set(agentSessionId, state);

  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    if (onChange) state.foldedSinks.delete(onChange);
    if (onReplace) state.replacementSinks.delete(onReplace);
    if (onMetadata) state.metadataSinks.delete(onMetadata);
    state.references -= 1;
    releaseState(state);
  };

  try {
    state.opening ??= open(state);
    await state.opening;
    const snapshot = await sessionMessages(agentSessionId);
    const bot = state.bot;
    if (!bot) throw new Error(`agent session ${agentSessionId} has no bot`);

    // Add sinks after getting the initial snapshot to avoid duplicate
    // notifications: buffered entries replayed during opening would otherwise
    // notify the sinks, and then the caller would also process the snapshot
    // (which includes those same messages).
    if (onChange) state.foldedSinks.add(onChange);
    if (onReplace) state.replacementSinks.add(onReplace);
    if (onMetadata) state.metadataSinks.add(onMetadata);

    return {
      bot,
      messages: snapshot.messages,
      metadata: snapshot.metadata,
      release,
    };
  } catch (error) {
    release();
    throw error;
  }
}

async function open(state: SessionState): Promise<void> {
  let machineOpen = false;
  try {
    const result = await agentHarnessServiceClient.getLog(state.agentSessionId);
    if (result.isErr()) {
      throw new Error(`failed to fetch agent session ${state.agentSessionId}`);
    }

    state.bot = result.value.bot;
    await openSession(state.agentSessionId, result.value.entries);
    machineOpen = true;

    // Frames can continue arriving while each worker request is in flight.
    // Drain until an empty check and `ready` assignment can happen together.
    const fetched = result.value.entries;
    while (state.buffered.length > 0) {
      const buffered = state.buffered;
      state.buffered = [];
      const replay = dropOverlap(fetched, buffered);
      if (replay.length > 0) await push(state, replay);
    }
    state.ready = true;
  } catch (error) {
    if (machineOpen) closeSession(state.agentSessionId);
    if (sessions.get(state.agentSessionId) === state) {
      sessions.delete(state.agentSessionId);
    }
    throw error;
  }
}

function releaseState(state: SessionState): void {
  if (state.references > 0) return;
  if (sessions.get(state.agentSessionId) !== state) return;
  if (!state.ready && state.opening) {
    void state.opening.finally(() => releaseState(state)).catch(() => {});
    return;
  }
  sessions.delete(state.agentSessionId);
  if (state.ready) closeSession(state.agentSessionId);
}

/** Route one realtime frame to its session's raw observers and shared fold. */
export function handleAgentSessionLog(event: AgentSessionLogEvent): void {
  for (const sink of rawSinks.get(event.agentSessionId) ?? []) sink(event);

  const state = sessions.get(event.agentSessionId);
  if (!state) return;
  const entry = entryOf(event);
  if (!state.ready) {
    state.buffered.push(entry);
    return;
  }
  void push(state, [entry]).catch((error: unknown) => {
    console.error('[agent-fold] live frame could not be folded', error);
  });
}

async function push(
  state: SessionState,
  entries: AgentSessionLogEntryDto[]
): Promise<void> {
  const events = await pushSessionEntries(state.agentSessionId, entries);
  if (sessions.get(state.agentSessionId) !== state) return;
  // Apply in order: a replacement invalidates every earlier message event,
  // and later live updates must land on the newly committed conversation.
  for (const event of events) {
    if (event.kind === 'metadata') continue;
    if (event.kind === 'replace') {
      for (const sink of state.replacementSinks) sink(event.messages);
    } else {
      for (const sink of state.foldedSinks) sink([event.message]);
    }
  }
  const metadata = events.findLast((event) => event.kind === 'metadata');
  if (metadata) {
    for (const sink of state.metadataSinks) sink(metadata.metadata);
  }
}

/**
 * Reconcile transport rows against an authoritative effective-history snapshot.
 * Its first row is the inclusive boundary in the repository's (createdAt, id)
 * order. Older rows were excluded by history selection, not missed by GET.
 * Distinct rows with identical ACP content remain distinct.
 */
export function dropOverlap(
  fetched: AgentSessionLogEntryDto[],
  buffered: AgentSessionLogEntryDto[]
): AgentSessionLogEntryDto[] {
  const boundary = fetched[0];
  if (!boundary) return buffered;
  const snapshotIds = new Set(fetched.map((entry) => entry.id));
  return buffered.filter(
    (entry) =>
      compareLogCursor(entry, boundary) >= 0 && !snapshotIds.has(entry.id)
  );
}

/** Compare UTC timestamps without losing Postgres submillisecond precision. */
function compareLogCursor(
  left: AgentSessionLogEntryDto,
  right: AgentSessionLogEntryDto
): number {
  // Chrono emits UTC with variable fractional precision. Pad before comparing;
  // Date.parse would collapse distinct microseconds into the same millisecond.
  const timestamp = (entry: AgentSessionLogEntryDto) =>
    entry.createdAt.replace(
      /(?:\.(\d+))?Z$/,
      (_match, fraction: string = '') => `.${fraction.padEnd(9, '0')}Z`
    );
  const a = timestamp(left);
  const b = timestamp(right);
  return a < b
    ? -1
    : a > b
      ? 1
      : left.id < right.id
        ? -1
        : left.id > right.id
          ? 1
          : 0;
}
