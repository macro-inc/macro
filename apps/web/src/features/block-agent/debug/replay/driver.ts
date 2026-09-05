/**
 * Playback engine for one replay session.
 *
 * The driver owns a recording split in two: entries before `splitIndex` are
 * served as the persisted log (`getLog`), the rest stream one at a time
 * through the real realtime entry point, `handleAgentSessionLog` — so
 * buffering, `dropOverlap`, the worker fold, and the status projection all
 * run exactly as they do against the gateway.
 *
 * Two knobs exist purely to provoke the catch-up paths: `fetchDelayMs` holds
 * the `getLog` response open so streamed frames land while the fetch is in
 * flight (they must buffer), and `overlap` rewinds the stream to before the
 * split so the first streamed frames duplicate fetched ones (they must drop).
 */

import type { ResultError } from '@core/util/result';
import { handleAgentSessionLog } from '@queries/agent-session/session-fold';
import type {
  AgentSessionLogEntryDto,
  AgentSessionResponse,
  SessionBot,
} from '@service-agent-harness/generated/schemas';
import { err, ok } from 'neverthrow';
import { type Accessor, createSignal } from 'solid-js';
import type { ReplayBackend } from './interceptor';

export const REPLAY_BOT: SessionBot = { id: 'replay-bot', name: 'Replay' };
export const REPLAY_OWNER = 'macro|replay@example.com';

/** POST ack → frame in the log, same ordering the harness produces. */
const PROMPT_ECHO_DELAY_MS = 150;

export type ReplayDriverOptions = {
  agentSessionId: string;
  entries: AgentSessionLogEntryDto[];
  /** How many entries `getLog` returns; the rest stream. */
  splitIndex: number;
  /** Streaming starts this many entries before the split (dedup exercise). */
  overlap: number;
  /** How long `getLog` stays in flight (catch-up buffering exercise). */
  fetchDelayMs: number;
  /** Delay between streamed frames while playing. Read per frame. */
  frameIntervalMs: Accessor<number>;
  /** When true, `control` rejects — the composer's failed/retry path. */
  controlFails: Accessor<boolean>;
};

export type ReplayDriver = {
  backend: ReplayBackend;
  /** Next entry to stream; `total` when the recording is exhausted. */
  cursor: Accessor<number>;
  total: number;
  playing: Accessor<boolean>;
  play: () => void;
  pause: () => void;
  /** Stream exactly one frame. */
  step: () => void;
  dispose: () => void;
};

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function replayFailure(): ResultError<'SERVER_ERROR'> {
  return Object.assign(new Error('replay harness: simulated failure'), {
    code: 'SERVER_ERROR' as const,
  });
}

function sessionFixture(id: string): AgentSessionResponse {
  const now = new Date().toISOString();
  return {
    botId: REPLAY_BOT.id,
    createdAt: now,
    harness: 'replay',
    id,
    model: 'replay',
    modifiedAt: now,
    name: 'Agent Session',
    ownerId: REPLAY_OWNER,
    repoUrl: 'https://example.com/replay.git',
    sandboxSize: 'default',
    status: { kind: 'no_messages' },
    workspace: '/workspace',
  };
}

/** The frame the harness would append for a prompt accepted over `control`. */
function promptEcho(prompt: string): AgentSessionLogEntryDto {
  return {
    createdAt: new Date().toISOString(),
    userId: REPLAY_OWNER,
    direction: 'to_runtime',
    content: {
      type: 'acp',
      jsonrpc: '2.0',
      id: crypto.randomUUID(),
      method: 'session/prompt',
      params: { prompt: [{ type: 'text', text: prompt }] },
    },
  };
}

export function createReplayDriver(options: ReplayDriverOptions): ReplayDriver {
  const { agentSessionId, entries } = options;
  const splitIndex = Math.max(0, Math.min(options.splitIndex, entries.length));
  const [cursor, setCursor] = createSignal(
    Math.max(0, splitIndex - options.overlap)
  );
  const [playing, setPlaying] = createSignal(false);
  let disposed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const emit = (entry: AgentSessionLogEntryDto) => {
    handleAgentSessionLog({ agentSessionId, ...entry });
  };

  const pause = () => {
    setPlaying(false);
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
  };

  const step = () => {
    const at = cursor();
    const entry = entries[at];
    if (!entry) {
      pause();
      return;
    }
    setCursor(at + 1);
    emit(entry);
  };

  const tick = () => {
    timer = undefined;
    if (disposed || !playing()) return;
    step();
    if (cursor() >= entries.length) {
      setPlaying(false);
      return;
    }
    timer = setTimeout(tick, options.frameIntervalMs());
  };

  const play = () => {
    if (disposed || playing() || cursor() >= entries.length) return;
    setPlaying(true);
    tick();
  };

  const backend: ReplayBackend = {
    get: async () => ok(sessionFixture(agentSessionId)),
    getLog: async () => {
      if (options.fetchDelayMs > 0) await delay(options.fetchDelayMs);
      return ok({ bot: REPLAY_BOT, entries: entries.slice(0, splitIndex) });
    },
    control: async (request) => {
      if (options.controlFails()) return err([replayFailure()]);
      if (request.type === 'prompt') {
        const prompt = request.prompt;
        setTimeout(() => {
          if (!disposed) emit(promptEcho(prompt));
        }, PROMPT_ECHO_DELAY_MS);
      }
      // Every other action — stop, permissions — acks and does nothing:
      // their observable effects come from frames, which playback owns. The
      // response is what the real endpoint returns; replay frames never
      // carry the id, so nothing correlates against it, and replay has no
      // queue, so everything is `sent`.
      return ok({ actionId: `replay-action-${cursor()}`, status: 'sent' });
    },
  };

  return {
    backend,
    cursor,
    total: entries.length,
    playing,
    play,
    pause,
    step,
    dispose: () => {
      disposed = true;
      pause();
    },
  };
}
