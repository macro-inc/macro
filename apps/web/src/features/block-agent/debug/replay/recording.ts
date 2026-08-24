/**
 * Parse a recorded agent session into the wire entries the fold consumes.
 *
 * Recording, DB row, and realtime event share one frame shape
 * (`crates/agent_fold/src/inbound/wasm.rs`): `{direction, content}` plus
 * attribution. The recorder (`~/.agent_runtime_sessions/<id>.jsonl`) writes
 * `ts` where the log row carries `createdAt`; that re-keying is the whole
 * translation.
 */

import type { AgentSessionLogEntryDto } from '@service-agent-harness/generated/schemas';

type RecordedLine = {
  ts?: string;
  createdAt?: string;
  userId?: string | null;
  direction?: string;
  content?: unknown;
};

/**
 * Parse recorder JSONL into log entries. Throws with a line number on the
 * first malformed line — this feeds a debug page, so a broken recording
 * should fail loudly rather than fold a truncated transcript.
 */
export function parseRecording(jsonl: string): AgentSessionLogEntryDto[] {
  const entries: AgentSessionLogEntryDto[] = [];
  const lines = jsonl.split('\n');
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!.trim();
    if (!line) continue;
    let parsed: RecordedLine;
    try {
      parsed = JSON.parse(line) as RecordedLine;
    } catch {
      throw new Error(`recording line ${index + 1} is not JSON`);
    }
    const { direction, content } = parsed;
    if (direction !== 'to_server' && direction !== 'to_runtime') {
      throw new Error(`recording line ${index + 1} has no direction`);
    }
    if (typeof content !== 'object' || content === null) {
      throw new Error(`recording line ${index + 1} has no content envelope`);
    }
    entries.push({
      content: content as AgentSessionLogEntryDto['content'],
      createdAt: parsed.createdAt ?? parsed.ts ?? new Date(0).toISOString(),
      direction,
      ...(parsed.userId ? { userId: parsed.userId } : {}),
    });
  }
  return entries;
}

/** A user prompt on its way to the runtime — the frame a turn starts with. */
export function isPromptEntry(entry: AgentSessionLogEntryDto): boolean {
  const content = entry.content as { type?: string; method?: string };
  return (
    entry.direction === 'to_runtime' &&
    content.type === 'acp' &&
    content.method === 'session/prompt'
  );
}
