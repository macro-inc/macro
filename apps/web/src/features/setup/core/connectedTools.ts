type PipedreamConnection = { server_name: string };
type NativeServer = { server_name: string; authenticated: boolean };

/**
 * Whether the named MCP tool is connected. Mirrors the backend's
 * stack-selection rule (`mcp_select`): a user with any Pipedream connectors is
 * served those, so native rows stop counting.
 */
export function isMcpToolConnected(
  name: string,
  sources: {
    pipedream: readonly PipedreamConnection[];
    native: readonly NativeServer[];
  }
) {
  const wanted = name.toLowerCase();
  if (sources.pipedream.length > 0)
    return sources.pipedream.some(
      (connection) => connection.server_name.toLowerCase() === wanted
    );
  return sources.native.some(
    (server) => server.authenticated && server.server_name.toLowerCase() === wanted
  );
}
