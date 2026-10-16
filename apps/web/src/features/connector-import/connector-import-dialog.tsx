import { openChatWithInput } from '@app/features/chat/ChatWithAgentButton';
import { buildSimpleEntityUrl } from '@core/util/url';
import {
  type ImportState,
  useDiscoverMutation,
  useImportQuery,
  useRunImportMutation,
} from '@queries/import';
import {
  connectPipedreamApp,
  usePipedreamConnectedSlugs,
} from '@queries/pipedream-connectors';
import type { JSX } from 'solid-js';
import { ConnectorImportProvider } from './context/connector-import-context';
import type { ConnectorImportContext } from './context/contracts';
import type { ImportCategoryConfig } from './core/providers';
import {
  ConnectorImportDialog,
  type ImportAlternative,
} from './views/import-dialog';

const PENDING_STATE: ImportState = { runs: [], entities: [] };

function useProductionContext(): ConnectorImportContext {
  const discover = useDiscoverMutation();
  const runImport = useRunImportMutation();
  return {
    createConnections() {
      const { slugs, ready } = usePipedreamConnectedSlugs();
      return { connected: slugs, ready };
    },
    createImportState() {
      const query = useImportQuery();
      return {
        // Guard resource reads so polling never suspends the dialog.
        state: () => (query.isSuccess ? query.data : PENDING_STATE),
        ready: () => query.isSuccess && !query.isPlaceholderData,
      };
    },
    connect: (app, container) =>
      connectPipedreamApp({
        appSlug: app.appSlug,
        serverName: app.name,
        container,
      }),
    discover: (source) => discover.mutateAsync(source),
    runImport: async (importIds) => {
      await runImport.mutateAsync({ importIds, discardIds: [] });
    },
    startAgentImport: (handoff) =>
      openChatWithInput(handoff.input, { instructions: handoff.instructions }),
    entityHref: (entity) => buildSimpleEntityUrl(entity),
  };
}

/**
 * The import dialog wired to production: the Pipedream connector stack, the
 * import pipeline, and agent handoff. Loaded on demand by the sidebar card,
 * so the card itself renders with its view.
 */
export function ConnectorImportDialogHost(props: {
  config: ImportCategoryConfig;
  open: boolean;
  onOpenChange(open: boolean): void;
  opener?: HTMLElement;
  alternatives?: readonly ImportAlternative[];
  onImported(): void;
}): JSX.Element {
  return (
    <ConnectorImportProvider context={useProductionContext()}>
      <ConnectorImportDialog
        config={props.config}
        open={props.open}
        onOpenChange={props.onOpenChange}
        opener={props.opener}
        alternatives={props.alternatives}
        onImported={props.onImported}
      />
    </ConnectorImportProvider>
  );
}
