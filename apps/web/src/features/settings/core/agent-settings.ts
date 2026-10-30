import { MACRO_HARNESS_NAME } from '@core/constant/macroAgent';
import type { AgentWithHarnessId } from '@queries/agents/agents';
import type { AgentModelTarget } from '@queries/agents/models';

export type AgentShare = 'Private' | 'Team';
export type ChannelMode = 'all' | 'selected';

export type AgentSummary = {
  id: string;
  name: string;
  tag: string;
  avatarUrl?: string;
  instructions: string;
  /** "In Macro", "In Cursor", … for the row's subtitle. */
  whereItRuns: string;
  defaultModel: string;
  channelSummary: string;
  share: AgentShare;
  persistedAgent?: AgentWithHarnessId;
  editable?: boolean;
};

export type ConnectedHarness = {
  id: string;
  name: string;
  kind: 'builtin' | 'macrod';
  allowPermissionBypass: boolean;
  target: AgentModelTarget;
  connected?: boolean;
};

export const IN_MEMORY_HARNESS: ConnectedHarness = {
  id: 'in-memory',
  name: MACRO_HARNESS_NAME,
  kind: 'builtin',
  allowPermissionBypass: true,
  target: { harness: 'in-memory' },
};

export function slugAgentTag(value: string): string {
  return value
    .toLowerCase()
    .replace(/^@/, '')
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
