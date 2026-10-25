import { openChatWithInput } from '@app/features/chat/ChatWithAgentButton';
import { nativeToolSlug } from '@app/features/onboarding/queries/connected-tools';
import {
  assignOauthUrl,
  reserveOauthPopup,
} from '@app/features/settings/connections/mcp-oauth';
import { Telemetry } from '@macro-inc/observability';
import {
  useMcpServersQuery,
  useStartMcpAuthMutation,
} from '@queries/mcp-servers';
import {
  connectPipedreamApp,
  usePipedreamConnectedSlugs,
} from '@queries/pipedream-connectors';
import { createMemo, type JSX } from 'solid-js';
import { ConnectorImportProvider } from './context/connector-import-context';
import type {
  ConnectOutcome,
  ConnectorImportContext,
} from './context/contracts';
import type { ImportCategoryConfig } from './core/providers';
import {
  ConnectorImportDialog,
  type ImportAlternative,
} from './views/import-dialog';

function useProductionContext(): ConnectorImportContext {
  const startMcpAuth = useStartMcpAuthMutation();

  // Opens the OAuth tab synchronously, inside the click, so it isn't blocked.
  function connectNative(app: {
    appSlug: string;
    name: string;
    mcpUrl: string;
  }): Promise<ConnectOutcome> {
    const popup = reserveOauthPopup();
    return Telemetry.span(
      'mcp.authorize',
      async (span): Promise<ConnectOutcome> => {
        span.setAttr('connector.app_slug', app.appSlug);
        span.setAttr('connector.server_url', app.mcpUrl);
        try {
          const { authorization_url } = await startMcpAuth.mutateAsync({
            server_url: app.mcpUrl,
            server_name: app.name,
          });
          assignOauthUrl(popup, authorization_url);
          span.setAttr('connector.outcome', 'started');
          return 'started';
        } catch (error) {
          popup?.close();
          span.error('MCP authorization failed to start');
          throw error;
        }
      }
    );
  }

  return {
    createConnections() {
      const pipedream = usePipedreamConnectedSlugs();
      // Refetches on focus, so returning from the OAuth tab shows the result.
      const native = useMcpServersQuery({ neverSuspend: true });
      const nativeSlugs = createMemo(() =>
        native.isSuccess
          ? native.data.flatMap((server) => {
              const slug =
                server.authenticated && server.enabled
                  ? nativeToolSlug(server)
                  : undefined;
              return slug ? [slug] : [];
            })
          : []
      );
      return {
        connected: () => new Set([...pipedream.slugs(), ...nativeSlugs()]),
        // A failed native read leaves Pipedream's answer standing.
        ready: () =>
          pipedream.ready() &&
          (native.isError || (native.isSuccess && !native.isPlaceholderData)),
      };
    },
    connect: (app, container) =>
      app.mcpUrl
        ? connectNative({ ...app, mcpUrl: app.mcpUrl })
        : connectPipedreamApp({
            appSlug: app.appSlug,
            serverName: app.name,
            container,
          }),
    startAgentImport: (handoff) =>
      openChatWithInput(handoff.input, { instructions: handoff.instructions }),
  };
}

/**
 * The import dialog wired to production: native MCP and Pipedream
 * connections, and the agent chat that runs each import. Loaded on demand by
 * the sidebar card, so the card itself renders with its view.
 */
export function ConnectorImportDialogHost(props: {
  config: ImportCategoryConfig;
  open: boolean;
  onOpenChange(open: boolean): void;
  opener?: HTMLElement;
  alternatives?: readonly ImportAlternative[];
}): JSX.Element {
  return (
    <ConnectorImportProvider context={useProductionContext()}>
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
