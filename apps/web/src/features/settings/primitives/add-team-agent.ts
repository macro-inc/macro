import { type Span, Telemetry } from '@macro-inc/observability';
import {
  fetchTeamAgents,
  useCreateTeamAgentMutation,
} from '@queries/team-agents/team-agents';
import type { ComputerSize } from '@service-auth/computers';
import type { CreateTeamAgent, TeamAgent } from '@service-auth/team-agents';
import { createSignal, onCleanup } from 'solid-js';
import { match } from 'ts-pattern';
import { waitForProgress } from '../computers/primitives/wait-for-progress';
import {
  ADD_AGENT_WAIT_MS,
  ADD_AGENT_WAITS_FOR,
  type AddAgentEnding,
  type AddAgentState,
  addedAgentProgress,
  addRefusal,
} from '../core/team-agent-add';
import { retryTeamAgentComputer } from './team-agent-status';

/** The agent's progress, or `undefined` when the list couldn't be read. */
async function readProgress(teamId: string, userId: string) {
  try {
    const agents = await fetchTeamAgents(teamId);
    return addedAgentProgress(agents.agents, userId);
  } catch {
    return undefined;
  }
}

/** Where the dialog goes once the agent is online, or is taking longer. */
export type AddedAgent = { agent: TeamAgent; online: boolean };

/**
 * Add an agent teammate and wait in the dialog until it is online. One
 * purchase key per dialog, replaced only once a purchase is undone (a
 * decline, or a refund after a second failed start), so a retry never pays
 * twice.
 */
export function useAddTeamAgent(options: {
  teamId: () => string;
  /** It is online (`online`), or still starting after the wait. */
  onAdded: (added: AddedAgent) => void;
}) {
  const create = useCreateTeamAgentMutation();
  const [state, setState] = createSignal<AddAgentState>({ kind: 'editing' });
  const [purchaseKey, setPurchaseKey] = createSignal(crypto.randomUUID());
  let disposed = false;
  onCleanup(() => {
    disposed = true;
  });
  const stopped = () => disposed;

  const finish = (
    span: Span,
    ending: AddAgentEnding,
    agent: TeamAgent,
    attempt: number
  ) => {
    span.setAttr('add.outcome', ending);
    span.setAttr('add.waits_for', ADD_AGENT_WAITS_FOR);
    if (disposed) return;
    match(ending)
      .with('online', 'slow', () =>
        options.onAdded({ agent, online: ending === 'online' })
      )
      // Taken back with its charge undone, e.g. after a second failed start.
      .with('gone', () => {
        setPurchaseKey(crypto.randomUUID());
        setState({ kind: 'refunded' });
      })
      .with('failed', () => {
        // The second failure is undone on the server: charge and computer.
        if (attempt > 1 || !agent.computerId) {
          setPurchaseKey(crypto.randomUUID());
          setState({ kind: 'refunded' });
          return;
        }
        setState({ kind: 'not_started', agent });
      })
      .exhaustive();
  };

  const add = async (request: CreateTeamAgent, size: ComputerSize) => {
    if (state().kind === 'adding') return;
    const teamId = options.teamId();
    setState({ kind: 'adding' });
    await Telemetry.span('team-agent.add', async (span) => {
      span.setAttr('team.id', teamId);
      span.setAttr('computer.size', request.size);
      span.setAttr('add.attempt', 1);
      let agent: TeamAgent;
      try {
        agent = await create.mutateAsync({ teamId, request, parentSpan: span });
      } catch (error) {
        const refused = addRefusal(error);
        span.setAttr('add.outcome', refused.kind);
        if (disposed) return;
        if (refused.kind === 'declined') setPurchaseKey(crypto.randomUUID());
        setState(
          match(refused)
            .returnType<AddAgentState>()
            .with({ kind: 'no_room' }, () => ({
              kind: 'no_room',
              size,
            }))
            .otherwise((other) => other)
        );
        return;
      }
      span.setAttr('agent.user_id', agent.userId);
      const ending = await span.span('team-agent.add.wait_online', (wait) =>
        waitForProgress({
          read: () => readProgress(teamId, agent.userId),
          waitMs: ADD_AGENT_WAIT_MS,
          span: wait,
          stopped,
        })
      );
      finish(span, ending, agent, 1);
    });
  };

  /** Starts the agent's computer again, on the same computer, no new charge. */
  const retry = async (agent: TeamAgent) => {
    const computerId = agent.computerId;
    if (!computerId || state().kind === 'adding') return;
    const teamId = options.teamId();
    setState({ kind: 'adding' });
    await Telemetry.span('team-agent.add', async (span) => {
      span.setAttr('team.id', teamId);
      span.setAttr('agent.user_id', agent.userId);
      span.setAttr('computer.id', computerId);
      span.setAttr('add.attempt', 2);
      try {
        await span.span('team-agent.add.retry', () =>
          retryTeamAgentComputer(computerId)
        );
      } catch {
        span.setAttr('add.outcome', 'retry_refused');
        if (!disposed) setState({ kind: 'not_started', agent });
        return;
      }
      const ending = await span.span('team-agent.add.wait_online', (wait) =>
        waitForProgress({
          read: () => readProgress(teamId, agent.userId),
          waitMs: ADD_AGENT_WAIT_MS,
          span: wait,
          stopped,
        })
      );
      finish(span, ending, agent, 2);
    });
  };

  return {
    state,
    purchaseKey,
    /** Back to editing after the name or size changed. */
    edit: () => {
      const current = state().kind;
      if (current === 'no_room' || current === 'refused')
        setState({ kind: 'editing' });
    },
    add,
    retry,
  };
}
