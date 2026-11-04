import { queryReadyGate } from '@queries/gate';
import { useHarnessesQuery } from '@queries/harnesses/harnesses';
import type { Harness } from '@service-storage/client';
import { type Accessor, createMemo } from 'solid-js';
import { useAgentsQuery } from './agents';

/** The agent fields the lookup reads; structural so tests need no wire type. */
type AgentLike = {
  bot: { id: string };
  harness: string;
  harness_id?: string | null;
};

/** The runtime fields the lookup reads. */
type RuntimeLike = Pick<Harness, 'id' | 'connected'>;

/**
 * The bot ids whose runtime is paired but not currently connected.
 *
 * Only macrod agents can be offline: a built-in or cloud runtime has no
 * paired machine behind it, and Cursor reports its own setup state. An agent
 * bound to a harness that is gone entirely (removed, or never visible to this
 * user) counts as offline too — starting it would hang the same way.
 */
export function offlineAgentBotIds(
  agents: readonly AgentLike[],
  runtimes: readonly RuntimeLike[]
): ReadonlySet<string> {
  const connected = new Set(
    runtimes.filter((runtime) => runtime.connected).map((runtime) => runtime.id)
  );
  return new Set(
    agents
      .filter(
        (agent) =>
          agent.harness === 'macrod' &&
          !(agent.harness_id && connected.has(agent.harness_id))
      )
      .map((agent) => agent.bot.id)
  );
}

/**
 * Live view of {@link offlineAgentBotIds}. Both queries are shared by key, so
 * every surface that calls this rides the harness list's existing poll rather
 * than adding one.
 */
export function useOfflineAgentBotIds(): Accessor<ReadonlySet<string>> {
  const agentsQuery = useAgentsQuery();
  const harnessesQuery = useHarnessesQuery();
  return createMemo(() => {
    // Until the runtimes are known, nothing is offline. Treating a pending
    // list as empty would flash "Offline" across a healthy roster on load.
    if (!queryReadyGate(harnessesQuery)) return EMPTY;
    return offlineAgentBotIds(
      queryReadyGate(agentsQuery) ? agentsQuery.data : [],
      harnessesQuery.data
    );
  });
}

const EMPTY: ReadonlySet<string> = new Set();
