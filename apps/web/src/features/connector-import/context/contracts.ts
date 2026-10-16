import type { ImportSource, ImportState } from '@service-cognition/import';
import type { Accessor } from 'solid-js';
import type { AgentImportHandoff } from '../core/agent-handoff';

export type ConnectOutcome = 'connected' | 'closed' | 'unsupported';

/** The user's connected apps; `ready` is false until the answer is known. */
type ConnectionsSource = {
  connected: Accessor<ReadonlySet<string>>;
  ready: Accessor<boolean>;
};

/** Import pipeline state; `ready` is false while serving a placeholder. */
type ImportStateSource = {
  state: Accessor<ImportState>;
  ready: Accessor<boolean>;
};

export type ConnectorImportContext = {
  /** Called inside an open dialog so its queries live only that long. */
  createConnections(): ConnectionsSource;
  createImportState(): ImportStateSource;
  /** Connect through Pipedream; `container` keeps the iframe usable in a modal. */
  connect(
    app: { appSlug: string; name: string },
    container?: HTMLElement
  ): Promise<ConnectOutcome>;
  /** Start finding items for a native source. */
  discover(source: ImportSource): Promise<void>;
  /** Accept staged rows; completion arrives through the import state. */
  runImport(importIds: string[]): Promise<void>;
  /** Hand a provider without a native importer to an agent chat. */
  startAgentImport(handoff: AgentImportHandoff): Promise<void>;
  entityHref(entity: { id: string; type: string }): string;
};
