import {
  type AgentModelTarget,
  buildAgentModelTargets,
} from '@queries/agents/models';
import type { Harness } from '@service-storage/client';

/** A runtime an agent can be bound to, with the model-discovery target for it. */
export type ConnectedRuntime = {
  id: string;
  name: string;
  kind: 'builtin' | 'macrod';
  target: AgentModelTarget;
  connected: boolean;
};

/**
 * Every runtime the editor can offer, in display order: Macro's harness,
 * Cursor when the caller has connected it, then each paired macrod daemon.
 */
export function connectedRuntimes(
  cursorConnected: boolean,
  harnesses: readonly Harness[]
): ConnectedRuntime[] {
  return buildAgentModelTargets(cursorConnected, harnesses).map((target) => {
    if (target.harness === 'in-memory') {
      return {
        id: 'in-memory',
        name: 'Macro Harness',
        kind: 'builtin',
        target,
        connected: true,
      };
    }
    if (target.harness === 'cursor') {
      return {
        id: 'cursor',
        name: 'Cursor',
        kind: 'builtin',
        target,
        connected: true,
      };
    }
    const harness = harnesses.find(
      (candidate) => candidate.id === target.harnessId
    );
    return {
      id: target.harnessId ?? '',
      name: harness
        ? harness.owner.type === 'team'
          ? `${harness.name} · Team`
          : harness.name
        : 'macrod',
      kind: 'macrod',
      target,
      connected: harness?.connected ?? false,
    };
  });
}
