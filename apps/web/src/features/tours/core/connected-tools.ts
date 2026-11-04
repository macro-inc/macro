type PipedreamConnection = { server_name: string; enabled: boolean };
type NativeServer = {
  server_name: string;
  authenticated: boolean;
  enabled: boolean;
};

/** Whether either stack has an enabled connection for the named provider. */
export function isMcpToolConnected(
  name: string,
  sources: {
    pipedream: readonly PipedreamConnection[];
    native: readonly NativeServer[];
  }
) {
  const wanted = name.toLowerCase();
  return (
    sources.pipedream.some(
      (connection) =>
        connection.enabled && connection.server_name.toLowerCase() === wanted
    ) ||
    sources.native.some(
      (server) =>
        server.enabled &&
        server.authenticated &&
        server.server_name.toLowerCase() === wanted
    )
  );
}
