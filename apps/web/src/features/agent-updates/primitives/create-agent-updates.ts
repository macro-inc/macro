import { createInteractionController } from '@app/features/agent-interactions/primitives/create-interaction-controller';
import { createToolApprovalController } from '@app/features/block-agent/primitives/create-tool-approval-controller';
import { issueSessionAction } from '@app/features/block-agent/queries/issue-session-action';
import { AgentSession } from '@core/agent-session/AgentSession';
import { toast } from '@core/component/Toast/Toast';
import { fireAndForget } from '@core/util/fireAndForget';
import { Telemetry } from '@macro-inc/observability';
import { answerAgentSessionToolApproval } from '@queries/agent-session/tool-approvals';
import type {
  FoldedMessage,
  PendingInteraction,
  SessionMetadata,
} from '@service-agent-fold/generated/types';
import type { ElicitationAnswer } from '@service-agent-harness/generated/schemas';
import {
  type Accessor,
  createRenderEffect,
  createSignal,
  on,
  onCleanup,
} from 'solid-js';
import {
  blockedSessions,
  eligibleSessions,
  selectAgentUpdates,
  type UpdateSession,
} from '../core/agent-update';

type LiveSession = Pick<
  AgentSession,
  'load' | 'snapshot' | 'subscribe' | 'release' | 'issue'
>;

type Source = {
  acquire: (id: string) => LiveSession;
  answerToolApproval: typeof answerAgentSessionToolApproval;
  onFailure: (message: string) => void;
};

type SessionState = {
  live: LiveSession;
  unsubscribe: () => void;
  released: boolean;
  pending: Accessor<PendingInteraction[]>;
  messages: Accessor<FoldedMessage[]>;
  interactions: ReturnType<typeof createInteractionController>;
  approvals: ReturnType<typeof createToolApprovalController>;
  release: () => void;
};

/** Owns headless folds only while matching sessions remain blocked. */
export function createAgentUpdates(
  sessions: Accessor<readonly UpdateSession[]>,
  ownerId: Accessor<string | undefined>,
  source: Source = {
    acquire: AgentSession.acquire,
    answerToolApproval: answerAgentSessionToolApproval,
    onFailure: toast.failure,
  }
) {
  const [revision, setRevision] = createSignal(0);
  const [now, setNow] = createSignal(Date.now());
  const opened = new Map<string, SessionState>();
  const selected = () => eligibleSessions(sessions(), ownerId());
  const tick = setInterval(() => setNow(Date.now()), 60_000);
  onCleanup(() => clearInterval(tick));

  function acquire(id: string): SessionState {
    const live = source.acquire(id);
    const [pending, setPending] = createSignal<PendingInteraction[]>([]);
    const [messages, setMessages] = createSignal<FoldedMessage[]>([]);
    const applyMetadata = (metadata: SessionMetadata) => {
      setPending(metadata.pendingInteractions);
      setRevision((value) => value + 1);
    };
    const unsubscribe = live.subscribe((events) => {
      for (const event of events) {
        if (event.kind === 'metadata') applyMetadata(event.metadata);
        else if (event.kind === 'replace') setMessages(event.messages);
        else
          setMessages((current) => {
            const index = current.findIndex(
              (message) =>
                message.turn === event.message.turn &&
                message.author.kind === event.message.author.kind
            );
            return index < 0
              ? [...current, event.message]
              : current.map((message, i) =>
                  i === index ? event.message : message
                );
          });
      }
      setRevision((value) => value + 1);
    });
    const interactions = createInteractionController({
      sessionId: () => id,
      pending,
      canEdit: () => Boolean(ownerId()),
      issue: (action) => issueSessionAction(live, action),
      onFailure: source.onFailure,
    });
    const approvals = createToolApprovalController({
      sessionId: () => id,
      pending,
      ownerId,
      userId: ownerId,
      canEdit: () => Boolean(ownerId()),
      answer: source.answerToolApproval,
      onFailure: source.onFailure,
    });
    const state: SessionState = {
      live,
      unsubscribe,
      released: false,
      pending,
      messages,
      interactions,
      approvals,
      release: () => {
        state.released = true;
        unsubscribe();
        live.release();
      },
    };
    async function load() {
      try {
        await live.load();
        if (state.released) return;
        const snapshot = await live.snapshot();
        if (state.released) return;
        setMessages(snapshot.messages);
        applyMetadata(snapshot.metadata);
      } catch {
        if (!state.released) source.onFailure("Couldn't load agent updates");
      }
    }
    fireAndForget(load(), 'agent-updates');
    return state;
  }

  createRenderEffect(
    on(
      () => blockedSessions(selected()).map((session) => session.id),
      (ids) => {
        const wanted = new Set(ids);
        for (const [id, state] of opened) {
          if (!wanted.has(id)) {
            state.release();
            opened.delete(id);
          }
        }
        for (const id of ids) {
          if (!opened.has(id)) opened.set(id, acquire(id));
        }
        setRevision((value) => value + 1);
      }
    )
  );
  onCleanup(() => {
    for (const state of opened.values()) state.release();
    opened.clear();
  });

  const updates = () => {
    revision();
    return selectAgentUpdates(
      selected(),
      new Map([...opened].map(([id, state]) => [id, state.pending()])),
      new Map([...opened].map(([id, state]) => [id, state.messages()])),
      now()
    );
  };
  const answer = async (
    update: ReturnType<typeof updates>[number],
    response: {
      optionId?: string;
      elicitation?: ElicitationAnswer;
      approval?: 'approve' | 'approve_and_remember' | 'deny';
    }
  ): Promise<boolean> => {
    if (update.kind !== 'interaction') return false;
    const state = opened.get(update.sessionId);
    if (!state) return false;
    return Telemetry.span('agent.updates.answer', async (span) => {
      span.setAttr('agent.session.id', update.sessionId);
      const request = update.request;
      const succeeded =
        request.kind === 'permission' && response.optionId
          ? await state.interactions.respond({
              kind: 'permission',
              turn: request.turn,
              requestId: request.requestId,
              answer: { kind: 'selected', optionId: response.optionId },
            })
          : request.kind === 'elicitation' && response.elicitation
            ? await state.interactions.respond({
                kind: 'elicitation',
                turn: request.turn,
                requestId: request.requestId,
                answer: response.elicitation,
              })
            : request.kind === 'tool_approval' && response.approval
              ? await state.approvals.answer(
                  request.approvalId,
                  response.approval
                )
              : false;
      if (!succeeded) span.error('Agent update answer failed');
      return succeeded;
    });
  };
  const answering = (update: ReturnType<typeof updates>[number]) => {
    if (update.kind !== 'interaction') return false;
    const state = opened.get(update.sessionId);
    if (!state) return false;
    return update.request.kind === 'tool_approval'
      ? state.approvals.answering(update.request.approvalId)
      : state.interactions.answering(update.request);
  };
  return { updates, answer, answering };
}
