// The agent session the permissions fixture renders in: one owner, a named
// agent, the transcript and pending holds the fixture sets, and the real
// tool approval controller answering through a scripted harness.
import type {
  FoldedMessage,
  PendingInteraction,
  SessionMetadata,
} from '@service-agent-fold/generated/types';
import { ok } from 'neverthrow';
import { createSignal } from 'solid-js';
import { createToolApprovalController } from '../primitives/create-tool-approval-controller';

export const OWNER = 'macro|dana@example.com';
const params = new URLSearchParams(location.search);
/** `?viewer=other`: someone who may watch the session but not edit Scout. */
export const VIEWER =
  params.get('viewer') === 'other' ? 'macro|sam@example.com' : OWNER;

const [messages, setMessages] = createSignal<FoldedMessage[]>([]);
const [pending, setPending] = createSignal<PendingInteraction[]>([]);
const metadata = (): SessionMetadata => ({
  harness: 'macro',
  model: null,
  supportedModels: [],
  configOptions: [],
  title: null,
  availableCommands: [],
  status: null,
  pendingInteractions: pending(),
  turn: pending().length > 0 ? 'running' : 'idle',
  notifications: [],
  reviewRevisions: [],
  noopTurn: null,
});

export const answers: { approvalId: string; answer: string }[] = [];

const toolApprovals = createToolApprovalController({
  sessionId: () => '019a0000-0000-7000-8000-0000000000a1',
  pending,
  ownerId: () => OWNER,
  userId: () => VIEWER,
  canEdit: () => true,
  onFailure: (message) => console.error(message),
  answer: async (_session, approvalId, answer) => {
    answers.push({ approvalId, answer });
    setPending((list) =>
      list.filter(
        (request) =>
          request.kind !== 'tool_approval' || request.approvalId !== approvalId
      )
    );
    onAnswered?.(approvalId, answer);
    return ok({ status: answer === 'deny' ? 'denied' : 'approved' } as never);
  },
});

let onAnswered: ((approvalId: string, answer: string) => void) | undefined;
export function whenAnswered(
  handler: (approvalId: string, answer: string) => void
) {
  onAnswered = handler;
}

const NAMES: Record<string, string> = {
  [OWNER]: 'Dana',
  'macro|sam@example.com': 'Sam',
};

export const session = {
  sessionId: () => '019a0000-0000-7000-8000-0000000000a1',
  userId: () => VIEWER,
  session: () => ({ ownerId: OWNER, canEdit: true }),
  bot: () => ({ id: 'agent-1', name: 'Scout', handle: 'scout' }),
  displayName: (id: string) => NAMES[id] ?? id,
  metadata,
  messages,
  turn: () => metadata().turn,
  toolApprovals,
  quoteSelection: () => undefined,
  runtimeRefusal: () => undefined,
};
export const useOptionalAgentSession = () => session;
export const useAgentSession = () => session;

export function showSession(next: FoldedMessage[], held: PendingInteraction[]) {
  setMessages(next);
  setPending(held);
}
