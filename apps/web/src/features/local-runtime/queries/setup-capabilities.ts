import { fireAndForget } from '@core/util/fireAndForget';
import {
  type MacrodStatus,
  macrodDetectAgents,
  macrodStart,
  macrodStatus,
  onMacrodStatus,
} from '@macro/tauri/macrod';
import {
  fetchAgentsList,
  useCreateAgentMutation,
} from '@queries/agents/agents';
import { agentModelsQueryOptions } from '@queries/agents/models';
import { queryClient } from '@queries/client';
import type { SetupCapabilities } from '../core/setup';

/**
 * Connecting covers pairing, which the app approves on its own, plus a first
 * adapter install; past this the daemon is stuck, not slow.
 */
const CONNECT_TIMEOUT_MS = 3 * 60 * 1000;

/** Resolve once the daemon runs, reporting each phase on the way. */
async function waitForRunning(
  onPhase: (phase: MacrodStatus['phase']) => void
): Promise<MacrodStatus> {
  // A promise settles once; later status events are no-ops.
  let resolveRunning: (status: MacrodStatus) => void = () => {};
  let rejectRunning: (error: Error) => void = () => {};
  const running = new Promise<MacrodStatus>((resolve, reject) => {
    resolveRunning = resolve;
    rejectRunning = reject;
  });
  const handle = (status: MacrodStatus) => {
    onPhase(status.phase);
    if (status.phase === 'running' && status.harnessId) {
      resolveRunning(status);
    } else if (status.phase === 'error') {
      rejectRunning(
        new Error(status.lastError ?? 'The local runtime stopped.')
      );
    }
  };

  const unlisten = await onMacrodStatus(handle);
  const timer = setTimeout(
    () => rejectRunning(new Error('Connecting this computer took too long.')),
    CONNECT_TIMEOUT_MS
  );
  try {
    // Listen first, then read: an event between the two is in the snapshot.
    handle(await macrodStatus());
    return await running;
  } finally {
    clearTimeout(timer);
    fireAndForget(unlisten(), 'local-runtime-setup');
  }
}

/** The production capabilities: the Tauri bridge and the agent queries. */
export function useSetupCapabilities(): SetupCapabilities {
  const createAgent = useCreateAgentMutation();
  return {
    detectAgents: macrodDetectAgents,
    startDaemon: macrodStart,
    waitForRunning,
    listAgents: async () =>
      (await fetchAgentsList()).map((agent) => ({
        botId: agent.bot.id,
        name: agent.bot.name,
        handle: agent.bot.handle,
        harnessId: agent.harness_id ?? null,
      })),
    // A catalog that was empty a moment ago is no answer for a runtime that
    // just came online, so always ask again.
    loadModels: async (harnessId) =>
      await queryClient.fetchQuery({
        ...agentModelsQueryOptions({ harness: 'macrod', harnessId }),
        staleTime: 0,
      }),
    createAgent: async (agent) => {
      const created = await createAgent.mutateAsync({
        name: agent.name,
        handle: agent.handle,
        description: agent.description,
        harness: 'macrod',
        harnessId: agent.harnessId,
        defaultModel: agent.defaultModel,
        instructions: '',
        channelIds: [],
        channelScope: 'all',
        mcp: { scope: 'owner_connections' },
        autoAcceptPermissions: agent.autoAcceptPermissions,
        isCoding: true,
      });
      return {
        botId: created.bot.id,
        name: created.bot.name,
        handle: created.bot.handle,
      };
    },
    sleep: async (ms) =>
      await new Promise((resolve) => setTimeout(resolve, ms)),
  };
}
