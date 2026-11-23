import type { Accessor } from 'solid-js';
import type { AgentImportHandoff } from '../core/agent-handoff';

/** `closed` means the user left the flow; nothing was connected. */
export type ConnectOutcome = 'connected' | 'closed';

/** The user's connected apps; `ready` is false until the answer is known. */
type ConnectionsSource = {
  connected: Accessor<ReadonlySet<string>>;
  /** Connected apps whose connection provides what Macro's import reads. */
  importable: Accessor<ReadonlySet<string>>;
  ready: Accessor<boolean>;
};

export type ConnectorImportContext = {
  /** Called inside an open dialog so its queries live only that long. */
  createConnections(): ConnectionsSource;
  /**
   * Connect the app however the server says; `container` keeps an embedded
   * connect dialog usable in a modal.
   */
  connect(
    app: { appSlug: string; name: string },
    container?: HTMLElement
  ): Promise<ConnectOutcome>;
  /** Hand the import to an agent chat in a split beside the current view. */
  startAgentImport(handoff: AgentImportHandoff): Promise<void>;
};
