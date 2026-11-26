import { useConnectors } from '@queries/connectors';
import { createMemo } from 'solid-js';

/** An MCP connection the AI can currently use, as the `/` menu lists it. */
export type SlashMenuMcp = {
  /** Its connector key. */
  id: string;
  name: string;
  /** Catalog slug for its icon; null for a server added by URL. */
  appSlug: string | null;
};

/**
 * The connected apps and servers that give agents tools, as the server
 * decided them: servers added by URL first, then apps.
 */
export function useSlashMenuMcps(enabled: () => boolean) {
  const connectors = useConnectors({ enabled });

  const mcps = createMemo((): SlashMenuMcp[] => {
    const usable = connectors
      .list()
      .filter((connector) => connector.status === 'connected' && connector.mcp)
      .map((connector) => ({
        id: connector.key,
        name: connector.name,
        appSlug: connector.target.type === 'app' ? connector.target.slug : null,
      }));
    return [
      ...usable.filter((item) => item.appSlug === null),
      ...usable.filter((item) => item.appSlug !== null),
    ];
  });

  const loading = () => !connectors.ready() && !connectors.error();

  return { mcps, loading, error: connectors.error };
}
