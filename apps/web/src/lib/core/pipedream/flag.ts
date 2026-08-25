import { useFeatureFlag } from '@app/lib/analytics/posthog';
import {
  DEV_MODE_ENV,
  getFeatureFlagOverride,
} from '@core/constant/featureFlags';
import type { Accessor } from 'solid-js';

/**
 * PostHog feature flag switching the MCP connector frontend from the native
 * stack (in-house OAuth, `/mcp/servers*`) to the Pipedream stack
 * (`/pipedream/mcp/*`). Frontend-only: the backend serves both stacks
 * unconditionally and picks a user's toolset by what they've connected
 * (Pipedream connectors win — see the `mcp_select` crate).
 */
export const PIPEDREAM_MCP_FLAG = 'pipedream-mcp';

/**
 * On in dev without waiting on PostHog — otherwise local and dev.macro.com
 * fall back to the native stack's fixed preset list and the searchable
 * Pipedream catalog is unreachable. Override either way with
 * VITE_ENABLE_PIPEDREAM_MCP; `undefined` defers to PostHog (production).
 */
export const PIPEDREAM_MCP_OVERRIDE =
  getFeatureFlagOverride('ENABLE_PIPEDREAM_MCP') ??
  (DEV_MODE_ENV ? true : undefined);

/** Whether this user sees the Pipedream connector frontend. */
export function usePipedreamMcpFlag(): Accessor<boolean> {
  const flag = useFeatureFlag(PIPEDREAM_MCP_FLAG, {
    enabledOverride: PIPEDREAM_MCP_OVERRIDE,
  });
  return () => flag().enabled;
}
