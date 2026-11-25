import { anyAbortSignal, untilAborted } from '@core/util/abort-signal';
import { type Span, Telemetry } from '@macro-inc/observability';
import {
  currentQueryAccount,
  isCurrentQueryAccount,
} from '@queries/auth/account-scope';
import { getOrCreateDirectMessageChannel } from '@queries/channel/get-or-create-dm';
import { fetchChannelSelectionById } from '@queries/channel/selection-by-id';
import { checkChannelTimelineAccess } from '@queries/messages/timeline';
import {
  fetchTeamAgents,
  useCreateTeamAgentMutation,
} from '@queries/team-agents/team-agents';
import type { ComputerSize } from '@service-auth/computers';
import type { CreateTeamAgent, TeamAgent } from '@service-auth/team-agents';
import { createEffect, createSignal, onCleanup } from 'solid-js';
import { waitForProgress } from '../computers/primitives/wait-for-progress';
import {
  ADD_AGENT_WAIT_MS,
  type AddAgentState,
  addedAgentProgress,
  addRefusal,
} from '../core/team-agent-add';
import { retryTeamAgentComputer } from './team-agent-status';

/** Add and wait for a readable DM. Each purchase key describes one purchase. */
export function useAddTeamAgent(options: {
  teamId: () => string;
  /** Captures the current invite's navigation and returns its validity check. */
  captureFlow: () => () => boolean;
  onReady: (channelId: string) => void;
  onAbandoned: () => void;
}) {
  const create = useCreateTeamAgentMutation();
  const [state, setState] = createSignal<AddAgentState>({ kind: 'editing' });
  const [purchaseKey, setPurchaseKey] = createSignal(crypto.randomUUID());
  let disposed = false;
  onCleanup(() => {
    disposed = true;
    activeFlow()?.lifetime.abort();
  });

  const capture = () => {
    const account = currentQueryAccount();
    const teamId = options.teamId();
    const isActiveFlow = options.captureFlow();
    return {
      teamId,
      lifetime: new AbortController(),
      stopped: () =>
        disposed ||
        !isActiveFlow() ||
        options.teamId() !== teamId ||
        !isCurrentQueryAccount(account),
    };
  };

  type InviteFlow = ReturnType<typeof capture>;
  const [activeFlow, setActiveFlow] = createSignal<InviteFlow>();

  const abandon = (flow: InviteFlow) => {
    if (!disposed && activeFlow() === flow) {
      flow.lifetime.abort();
      setActiveFlow(undefined);
      options.onAbandoned();
    }
  };

  // The invite can outlive a split or account change while a read is pending
  // or while it is waiting for the inviter to check again.
  createEffect(() => {
    const flow = activeFlow();
    if (flow?.stopped()) abandon(flow);
  });

  const start = () => {
    const flow = capture();
    if (flow.stopped()) return;
    setActiveFlow(flow);
    return flow;
  };

  const wait = async (
    span: Span,
    flow: InviteFlow,
    agent: TeamAgent,
    attempt: number
  ) => {
    if (agent.computerId) span.setAttr('computer.id', agent.computerId);
    let channelId: string | undefined;
    setState({ kind: 'adding', phase: 'startup' });
    const deadline = new AbortController();
    const expiresAt = Date.now() + ADD_AGENT_WAIT_MS;
    const timeout = window.setTimeout(
      () => deadline.abort(),
      ADD_AGENT_WAIT_MS
    );
    const signal = anyAbortSignal([flow.lifetime.signal, deadline.signal]);
    const stopped = () => signal.aborted || flow.stopped();

    const readConversation = async (readSpan: Span) => {
      // The canonical ID only resolves the pair. Both route read paths must
      // still accept it under the inviter's current credentials.
      if (!channelId) {
        const request = readSpan.run(
          async () => await getOrCreateDirectMessageChannel(agent.userId)
        );
        const result = await untilAborted(request, signal);
        if (result.isErr()) {
          readSpan.setAttr('conversation.outcome', 'resolve_failed');
          return 'waiting';
        }
        channelId = result.value;
        span.setAttr('channel.id', channelId);
      }
      if (stopped()) return 'waiting';

      const id = channelId;
      const channel = await untilAborted(
        readSpan.run(() => fetchChannelSelectionById(id, signal)),
        signal
      );
      if (!channel.isParticipant) {
        readSpan.setAttr('conversation.outcome', 'not_a_participant');
        return 'waiting';
      }
      if (stopped()) return 'waiting';

      await untilAborted(
        readSpan.run(() => checkChannelTimelineAccess(id)),
        signal
      );
      readSpan.setAttr('conversation.outcome', 'readable');
      return 'ready';
    };

    const ending = await span.span(
      'team-agent.add.wait_ready',
      async (waitSpan) => {
        try {
          return await waitForProgress({
            waitMs: ADD_AGENT_WAIT_MS,
            pollMs: 1_000,
            signal,
            span: waitSpan,
            stopped,
            read: async () => {
              try {
                const { agents } = await untilAborted(
                  waitSpan.run(() => fetchTeamAgents(flow.teamId)),
                  signal
                );
                const progress = addedAgentProgress(agents, agent.userId);
                if (stopped()) return undefined;
                if (progress !== 'online') return progress;

                setState({ kind: 'adding', phase: 'conversation' });
                return await waitSpan.span(
                  'team-agent.add.read_conversation',
                  readConversation
                );
              } catch {
                return undefined;
              }
            },
          });
        } finally {
          window.clearTimeout(timeout);
          deadline.abort();
        }
      }
    );
    if (flow.stopped()) {
      span.setAttr('add.outcome', 'abandoned');
      abandon(flow);
      return;
    }

    if (ending === 'slow' || Date.now() >= expiresAt) {
      span.setAttr('add.outcome', 'slow');
      setState({ kind: 'waiting', agent, attempt });
      return;
    }

    span.setAttr('add.outcome', ending);
    if (ending === 'ready' && channelId) {
      setActiveFlow(undefined);
      options.onReady(channelId);
    } else if (ending === 'failed' && attempt === 1 && agent.computerId) {
      setState({ kind: 'not_started', agent });
    } else {
      // The server undoes the charge and releases the computer.
      setPurchaseKey(crypto.randomUUID());
      setState({ kind: 'refunded' });
    }
  };

  const add = async (request: CreateTeamAgent, size: ComputerSize) => {
    if (state().kind === 'adding' || state().kind === 'waiting') return;
    const flow = start();
    if (!flow) return;
    setState({ kind: 'adding', phase: 'purchase' });
    await Telemetry.span('team-agent.add', async (span) => {
      span.setAttr('team.id', flow.teamId);
      span.setAttr('computer.size', request.size);
      span.setAttr('add.attempt', 1);
      let agent: TeamAgent;
      try {
        agent = await create.mutateAsync({
          teamId: flow.teamId,
          request,
          parentSpan: span,
        });
      } catch (error) {
        const refused = addRefusal(error);
        span.setAttr('add.outcome', refused.kind);
        if (flow.stopped()) {
          abandon(flow);
          return;
        }
        if (refused.kind === 'declined') setPurchaseKey(crypto.randomUUID());
        setState(
          refused.kind === 'no_room' ? { kind: 'no_room', size } : refused
        );
        return;
      }
      if (flow.stopped()) {
        span.setAttr('add.outcome', 'abandoned');
        abandon(flow);
        return;
      }
      await wait(span, flow, agent, 1);
    });
  };

  /** Starts the same computer again, with no new charge. */
  const retry = async (agent: TeamAgent) => {
    const computerId = agent.computerId;
    if (!computerId || state().kind !== 'not_started') return;
    const flow = start();
    if (!flow) return;
    setState({ kind: 'adding', phase: 'startup' });
    await Telemetry.span('team-agent.add', async (span) => {
      span.setAttr('team.id', flow.teamId);
      span.setAttr('computer.id', computerId);
      span.setAttr('add.attempt', 2);
      try {
        await span.span('team-agent.add.retry', () =>
          retryTeamAgentComputer(computerId)
        );
      } catch {
        span.setAttr('add.outcome', 'retry_refused');
        if (flow.stopped()) abandon(flow);
        else setState({ kind: 'not_started', agent });
        return;
      }
      if (flow.stopped()) {
        span.setAttr('add.outcome', 'abandoned');
        abandon(flow);
        return;
      }
      await wait(span, flow, agent, 2);
    });
  };

  const resume = async () => {
    const current = state();
    if (current.kind !== 'waiting') return;
    const flow = activeFlow();
    if (!flow) return;
    if (flow.stopped()) {
      abandon(flow);
      return;
    }
    await Telemetry.span('team-agent.add', async (span) => {
      span.setAttr('team.id', flow.teamId);
      span.setAttr('add.attempt', current.attempt);
      await wait(span, flow, current.agent, current.attempt);
    });
  };

  return {
    state,
    purchaseKey,
    edit: () => {
      const current = state().kind;
      if (current === 'no_room' || current === 'refused')
        setState({ kind: 'editing' });
    },
    add,
    retry,
    resume,
  };
}
