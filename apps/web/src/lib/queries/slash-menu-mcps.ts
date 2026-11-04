import { QUICK_CONNECT_SERVERS } from '@core/component/AI/constant/mcpServers';
import { canonicalPipedreamSlug } from '@core/pipedream/slugs';
import { queryReadyGate } from '@queries/gate';
import { useMcpServersQuery } from '@queries/mcp-servers';
import { usePipedreamConnectionsQuery } from '@queries/pipedream-connectors';
import { createMemo } from 'solid-js';

/** An MCP connection the AI can currently use, as the `/` menu lists it. */
export type SlashMenuMcp = {
  id: string;
  name: string;
  /** Provider slug for its bundled icon; null for custom native servers. */
  appSlug: string | null;
};

/** Mirrors `mcp_select::select_connections`: native credentials win per provider. */
export function useSlashMenuMcps(enabled: () => boolean) {
  const pipedream = usePipedreamConnectionsQuery({
    neverSuspend: true,
    enabled,
  });
  const native = useMcpServersQuery({ neverSuspend: true, enabled });

  const nativeMcps = createMemo((): SlashMenuMcp[] => {
    if (native.isPlaceholderData || !queryReadyGate(native)) return [];
    const endpoints = new Set<string>();
    return native.data.flatMap((server) => {
      const endpoint = server.url.replace(/\/+$/, '');
      const provider = QUICK_CONNECT_SERVERS.find(
        (item) => item.url === endpoint
      );
      if (
        !server.enabled ||
        (provider && !server.authenticated) ||
        endpoints.has(endpoint)
      )
        return [];
      endpoints.add(endpoint);
      return [
        {
          id: `mcp:${endpoint}`,
          name: server.server_name,
          appSlug: provider?.app_slug ?? null,
        },
      ];
    });
  });

  const mcps = createMemo((): SlashMenuMcp[] => {
    const servers = nativeMcps();
    // Wait for native selection before offering a duplicate hosted provider.
    if (native.isPlaceholderData || !queryReadyGate(native)) return servers;
    if (pipedream.isPlaceholderData || !queryReadyGate(pipedream))
      return servers;
    const providers = new Set(
      servers.flatMap((item) => (item.appSlug ? [item.appSlug] : []))
    );
    const connections = [...pipedream.data].sort(
      (a, b) =>
        Number(a.app_slug !== canonicalPipedreamSlug(a.app_slug)) -
        Number(b.app_slug !== canonicalPipedreamSlug(b.app_slug))
    );
    return [
      ...servers,
      ...connections.flatMap((connection) => {
        const slug = canonicalPipedreamSlug(connection.app_slug);
        if (!connection.enabled || providers.has(slug)) return [];
        providers.add(slug);
        return [
          {
            id: `pipedream:${connection.app_slug}`,
            name: connection.server_name,
            appSlug: connection.app_slug,
          },
        ];
      }),
    ];
  });

  const loading = () =>
    [native, pipedream].some(
      (query) => !query.isError && (query.isPending || query.isPlaceholderData)
    );
  const error = () => native.isError || pipedream.isError;

  return { mcps, loading, error };
}
