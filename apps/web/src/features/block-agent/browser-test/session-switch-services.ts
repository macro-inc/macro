/**
 * Stand-ins for the services an agent session reads, each answering after
 * `SERVER_MS`: the harness's session row, the GraphQL log, and the fold
 * worker. Everything between them and the screen is the app's own code.
 */

import type {
  FoldedMessage,
  FoldedStreamEvent,
  SessionMetadata,
} from '@service-agent-fold/generated/types';
import type {
  AgentSessionLogEntryDto,
  AgentSessionResponse,
} from '@service-agent-harness/generated/schemas';
import { ok } from 'neverthrow';

/** A round trip to the harness or DSS. */
export const SERVER_MS = 400;

/** How often each session's row and log were asked for. */
export const reads = {
  rows: new Map<string, number>(),
  logs: new Map<string, number>(),
};
const count = (map: Map<string, number>, id: string) =>
  map.set(id, (map.get(id) ?? 0) + 1);

const answer = <T>(value: T) =>
  new Promise<T>((resolve) => setTimeout(() => resolve(value), SERVER_MS));

export const agentHarnessServiceClient = {
  get: (id: string) => {
    count(reads.rows, id);
    return answer(
      ok({
        id,
        name: `Session ${id}`,
        canEdit: true,
        ownerId: 'macro|owner@example.com',
        botId: 'bot',
      } as AgentSessionResponse)
    );
  },
  control: () => answer(ok({ status: 'sent' as const })),
};

// --- @queries/agent-session/log

export class AgentSessionLogUnavailable extends Error {}
export const canFollowAgentSessionLog = () => false;
export const forgetAgentSessionLog = async () => undefined;
export function watchAgentSessionLog(id: string) {
  count(reads.logs, id);
  const row = {
    id: `${id}-row`,
    createdAt: '2026-11-06T00:00:00Z',
    direction: 'to_server',
    content: {},
  } as unknown as AgentSessionLogEntryDto;
  return {
    // Not opened in this browser before: nothing cached.
    cached: Promise.resolve(undefined),
    cacheMiss: () => 'no_cache' as const,
    fetched: answer({
      bot: { id: 'bot', name: 'Agent', handle: 'agent' },
      rows: [row],
    }),
    stop: () => {},
  };
}

// --- @core/agent-fold/client

const METADATA: SessionMetadata = {
  harness: 'macro',
  model: null,
  supportedModels: [],
  configOptions: [],
  title: null,
  availableCommands: [],
  status: null,
  pendingInteractions: [],
  turn: 'idle',
  notifications: [],
  reviewRevisions: [],
  noopTurn: null,
};
const folded = new Map<string, FoldedMessage[]>();

export class AgentFoldWorkerUnavailable extends Error {}
export async function preloadAgentFold() {}
export async function pushSession(
  id: string,
  inputs: { kind: string }[]
): Promise<FoldedStreamEvent[]> {
  if (!inputs.some((input) => input.kind === 'snapshot')) return [];
  const messages: FoldedMessage[] = [
    {
      agentSessionId: id,
      key: '0:agent',
      turn: 0,
      author: { kind: 'agent' },
      parts: [{ kind: 'text', text: `Transcript of ${id}` }],
      requestId: null,
      stop: null,
      pending: false,
      segments: [],
      phase: null,
      postedAt: null,
    },
  ];
  folded.set(id, messages);
  return [
    { kind: 'replace', messages },
    { kind: 'metadata', metadata: METADATA },
  ];
}
export async function readSession(id: string) {
  return { messages: folded.get(id) ?? [], metadata: METADATA };
}
export function closeSession(id: string) {
  folded.delete(id);
}
