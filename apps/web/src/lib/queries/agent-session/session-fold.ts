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
  onMetadata?: SessionMetadataSink;
}): Promise<{
  bot: SessionBot;
  messages: FoldedMessage[];
  metadata: SessionMetadata;
  release: () => void;
}> {
  const { agentSessionId, onChange, onMetadata } = args;
  const state = sessions.get(agentSessionId) ?? {
    agentSessionId,
    buffered: [],
    foldedSinks: new Set<FoldedMessageSink>(),
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
    let fetched = result.value.entries;
    while (state.buffered.length > 0) {
      const buffered = state.buffered;
      state.buffered = [];
      const replay = dropOverlap(fetched, buffered);
      fetched = [];
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
  const messages = events.flatMap((event) =>
    event.kind === 'metadata' ? [] : [event.message]
  );
  // Metadata is carried whole per event, latest-wins — only the last matters.
  const metadata = events.findLast((event) => event.kind === 'metadata');
  if (metadata) {
    for (const sink of state.metadataSinks) sink(metadata.metadata);
  }
  if (messages.length === 0) return;
  for (const sink of state.foldedSinks) sink(messages);
}

/** Return buffered frame occurrences not already present in the snapshot. */
export function dropOverlap(
  fetched: AgentSessionLogEntryDto[],
  buffered: AgentSessionLogEntryDto[]
): AgentSessionLogEntryDto[] {
  if (buffered.length === 0 || fetched.length === 0) return buffered;

  const fetchedCounts = new Map<string, number>();
  for (const entry of fetched) {
    const key = JSON.stringify(entry);
    fetchedCounts.set(key, (fetchedCounts.get(key) ?? 0) + 1);
  }

  return buffered.filter((entry) => {
    const key = JSON.stringify(entry);
    const remaining = fetchedCounts.get(key) ?? 0;
    if (remaining === 0) return true;
    fetchedCounts.set(key, remaining - 1);
    return false;
  });
}
