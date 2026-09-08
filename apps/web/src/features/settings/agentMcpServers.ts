import type { AgentMcpServer } from '@service-storage/generated/schemas/agentMcpServer';
import type { ConnectionState } from './integration-ui';

/** A catalog entry reduced to what the agent stores. */
export function catalogEntryToMcpServer(entry: {
  app_slug: string;
  display_name: string;
}): AgentMcpServer {
  return { app_slug: entry.app_slug, server_name: entry.display_name };
}

/** Appends `server` unless an entry with its slug is already listed. */
export function addMcpServer(
  list: readonly AgentMcpServer[],
  server: AgentMcpServer
): AgentMcpServer[] {
  if (list.some((existing) => existing.app_slug === server.app_slug)) {
    return [...list];
  }
  return [...list, server];
}

export function removeMcpServer(
  list: readonly AgentMcpServer[],
  appSlug: string
): AgentMcpServer[] {
  return list.filter((server) => server.app_slug !== appSlug);
}

/**
 * How a listed app reads for the viewer: connected if they hold a connection
 * for it, otherwise not. Selection is the agent's; connection is personal.
 */
export function mcpServerConnectionState(
  server: AgentMcpServer,
  connectedSlugs: ReadonlySet<string>
): ConnectionState {
  return connectedSlugs.has(server.app_slug) ? 'connected' : 'disconnected';
}
