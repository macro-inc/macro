import { openChatWithInput } from '@app/features/chat/ChatWithAgentButton';
import {
  appConnectorKey,
  connectConnector,
  useConnectors,
} from '@queries/connectors';
import { createMemo, type JSX } from 'solid-js';
import { ConnectorImportProvider } from './context/connector-import-context';
import type { ConnectorImportContext } from './context/contracts';
import type { ImportCategoryConfig } from './core/providers';
import {
  ConnectorImportDialog,
  type ImportAlternative,
} from './views/import-dialog';

const PRODUCTION_CONTEXT: ConnectorImportContext = {
  createConnections() {
    // Refetches on focus, so returning from a consent tab shows the result.
    const connectors = useConnectors();
    const importable = createMemo<ReadonlySet<string>>(
      () =>
        new Set(
          connectors
            .list()
            .flatMap((connector) =>
              connector.target.type === 'app' &&
              connector.status === 'connected' &&
              connector.importAvailable
                ? [connector.target.slug]
                : []
            )
        )
    );
    return {
      connected: connectors.connectedApps,
      importable,
      ready: connectors.ready,
    };
  },
  connect: async (app, container) =>
    await connectConnector({ key: appConnectorKey(app.appSlug), container }),
  startAgentImport: (handoff) =>
    openChatWithInput(handoff.input, { instructions: handoff.instructions }),
};

/**
 * The import dialog wired to production: the user's connectors, and the
 * agent chat that runs each import. Loaded on demand by the sidebar card, so
 * the card itself renders with its view.
 */
export function ConnectorImportDialogHost(props: {
  config: ImportCategoryConfig;
  open: boolean;
  onOpenChange(open: boolean): void;
  opener?: HTMLElement;
  alternatives?: readonly ImportAlternative[];
}): JSX.Element {
  return (
    <ConnectorImportProvider context={PRODUCTION_CONTEXT}>
      <ConnectorImportDialog
        config={props.config}
        open={props.open}
        onOpenChange={props.onOpenChange}
        opener={props.opener}
        alternatives={props.alternatives}
      />
    </ConnectorImportProvider>
  );
}
