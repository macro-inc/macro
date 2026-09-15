import { useAgentsQuery } from '@queries/agents/agents';
import { useAgentModelsQuery } from '@queries/agents/models';
import { useCursorApiKeyStatusQuery } from '@queries/auth/cursor-api-key';
import { useHarnessesQuery } from '@queries/harnesses/harnesses';
import { type Accessor, createMemo } from 'solid-js';
import { buildAgentRoster, type RosterAgent } from '../core/roster';

export type AgentRosterSource = {
  /** Every agent and coder the caller can see, first-party ones first. */
  roster: Accessor<RosterAgent[]>;
  /** The saved agents are still on their first load. */
  loading: Accessor<boolean>;
  /** The saved agents failed to load; the first-party ones are still listed. */
  error: Accessor<boolean>;
  cursorConnected: Accessor<boolean>;
};

/**
 * Joins the saved agents, the registered macrod runtimes, and the Cursor
 * connection into one roster. Model defaults for the first-party personas
 * come from model discovery, so their pills can name what they will run on.
 */
export function createAgentRosterSource(): AgentRosterSource {
  const agentsQuery = useAgentsQuery();
  const harnessesQuery = useHarnessesQuery();
  const cursorStatus = useCursorApiKeyStatusQuery();
  const cursorConnected = () =>
    cursorStatus.isSuccess ? cursorStatus.data.registered : false;
  const cursorNeedsConnection = () =>
    cursorStatus.isSuccess &&
    !cursorStatus.isPlaceholderData &&
    !cursorStatus.data.registered;
  const macroDefaults = useAgentModelsQuery(() => ({ harness: 'in-memory' }));
  const cursorDefaults = useAgentModelsQuery(
    () => ({ harness: 'cursor' }),
    cursorConnected
  );

  const roster = createMemo(() =>
    buildAgentRoster({
      agents: agentsQuery.isSuccess ? agentsQuery.data : [],
      runtimes: harnessesQuery.isSuccess ? harnessesQuery.data : [],
      cursorConnected: cursorConnected(),
      cursorNeedsConnection: cursorNeedsConnection(),
      macroDefaultModel: macroDefaults.isSuccess
        ? (macroDefaults.data.currentModel ?? undefined)
        : undefined,
      cursorDefaultModel: cursorStatus.isSuccess
        ? (cursorStatus.data.defaultModelId ??
          (cursorDefaults.isSuccess
            ? (cursorDefaults.data.currentModel ?? undefined)
            : undefined))
        : undefined,
    })
  );

  return {
    roster,
    loading: () => agentsQuery.isPending,
    error: () => agentsQuery.isError,
    cursorConnected,
  };
}
