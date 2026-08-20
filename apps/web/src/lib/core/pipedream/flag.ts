import { useFeatureFlag } from '@app/lib/analytics/posthog';
import type { Accessor } from 'solid-js';

/**
 * PostHog feature flag switching the MCP connector frontend from the native
 * stack (in-house OAuth, `/mcp/servers*`) to the Pipedream stack
 * (`/pipedream/mcp/*`). Frontend-only: the backend serves both stacks
 * unconditionally and picks a user's toolset by what they've connected
 * (Pipedream connectors win — see the `mcp_select` crate).
 */
export const PIPEDREAM_MCP_FLAG = 'pipedream-mcp';

/** Whether this user sees the Pipedream connector frontend. */
export function usePipedreamMcpFlag(): Accessor<boolean> {
  const flag = useFeatureFlag(PIPEDREAM_MCP_FLAG);
  return () => flag().enabled;
}
