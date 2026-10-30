import type { Accessor } from 'solid-js';
import type { AgentImportHandoff } from '../core/agent-handoff';

/**
 * `started` means authorization continues in another tab; the connection
 * shows up in `createConnections` once it finishes.
 */
export type ConnectOutcome = 'connected' | 'started' | 'closed' | 'unsupported';

/** The user's connected apps; `ready` is false until the answer is known. */
type ConnectionsSource = {
  connected: Accessor<ReadonlySet<string>>;
  ready: Accessor<boolean>;
};

export type ConnectorImportContext = {
  /** Called inside an open dialog so its queries live only that long. */
  createConnections(): ConnectionsSource;
  /**
   * Connect through the app's native MCP server when it has one, otherwise
   * Pipedream; `container` keeps Pipedream's iframe usable in a modal.
   */
  connect(
    app: { appSlug: string; name: string; mcpUrl?: string },
    container?: HTMLElement
  ): Promise<ConnectOutcome>;
  /** Hand the import to an agent chat in a split beside the current view. */
  startAgentImport(handoff: AgentImportHandoff): Promise<void>;
};
