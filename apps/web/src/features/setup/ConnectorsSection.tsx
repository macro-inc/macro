import {
  FEATURED_MCP_SERVERS,
  type FeaturedMcpServer,
} from '@core/component/AI/constant/mcpServers';
import { toast } from '@core/component/Toast/Toast';
import ArrowUpRightIcon from '@phosphor/arrow-up-right.svg';
import SpinnerIcon from '@phosphor/spinner-gap.svg';
import {
  useAddMcpServerMutation,
  useMcpServersQuery,
  useStartMcpAuthMutation,
} from '@queries/mcp-servers';
import type { StartAuthResponse } from '@service-cognition/generated/schemas';
import { cn } from '@ui';
import { createMemo, createSignal, For, Match, Switch } from 'solid-js';
import { StatusDot } from '../settings/integration-ui';
import { SettingsSection } from '../settings/primitives';

/** The connectors onboarding leads with (the ones the builder acts on). */
const SETUP_CONNECTOR_NAMES = ['Linear', 'GitHub', 'Notion', 'Slack'];

/**
 * One connector as a compact chip (per the onboarding wireframe): icon +
 * name + a status dot when connected, or a quiet connect arrow when not.
 * Clicking an unconnected chip kicks off add + OAuth in a popup; the server
 * reconciles the moment OAuth completes, and the polled servers query flips
 * the chip when the user returns.
 */
function ConnectorChip(props: {
  server: FeaturedMcpServer;
  connected: boolean;
  authenticated: boolean;
}) {
  const addMutation = useAddMcpServerMutation();
  const authMutation = useStartMcpAuthMutation();
  const [busy, setBusy] = createSignal(false);

  const handleConnect = async () => {
    if (props.authenticated || busy()) return;
    setBusy(true);
    try {
      if (!props.connected) {
        await addMutation.mutateAsync({
          server_name: props.server.server_name,
          url: props.server.url,
        });
      }
      const result: StartAuthResponse = await authMutation.mutateAsync({
        server_name: props.server.server_name,
        server_url: props.server.url,
      });
      window.open(result.authorization_url, '_blank');
    } catch {
      toast.failure(`Failed to connect ${props.server.server_name}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      title={
        props.authenticated
          ? `${props.server.server_name} is connected`
          : props.server.tagline
      }
      onClick={() => void handleConnect()}
      class={cn(
        'inline-flex h-7 items-center gap-1.5 rounded-lg border px-2.5 text-[13px]',
        'cursor-default transition-colors outline-none focus-visible:ring-1 focus-visible:ring-accent/50',
        props.authenticated
          ? 'border-ink/10 bg-surface text-ink'
          : 'border-ink/5 text-ink-muted hover:border-ink/10 hover:text-ink'
      )}
    >
      <span class="flex size-3.5 shrink-0 items-center justify-center [&_svg]:size-3.5">
        <props.server.icon />
      </span>
      {props.server.server_name}
      <Switch
        fallback={
          <ArrowUpRightIcon class="size-3 shrink-0 text-ink-extra-muted" />
        }
      >
        <Match when={props.authenticated}>
          <StatusDot state="connected" label="Connected" />
        </Match>
        <Match when={busy()}>
          <SpinnerIcon class="size-3 shrink-0 animate-spin text-ink-extra-muted" />
        </Match>
      </Switch>
    </button>
  );
}

/**
 * The tools half of "connect your work": the core connectors as one row of
 * compact chips — connected ones carry a status dot, the rest are one-click
 * OAuth. Connected tools feed the workspace builder on the right.
 */
export function ConnectorsSection() {
  const serversQuery = useMcpServersQuery();

  const featured = SETUP_CONNECTOR_NAMES.flatMap(
    (name) =>
      FEATURED_MCP_SERVERS.find((server) => server.server_name === name) ?? []
  );

  const serverByUrl = createMemo(() => {
    const map = new Map<string, { authenticated: boolean }>();
    for (const server of serversQuery.data ?? []) {
      map.set(server.url, { authenticated: server.authenticated });
    }
    return map;
  });

  return (
    <SettingsSection
      title="Bring your tools"
      description="Macro suggests what to bring over from each tool you connect."
    >
      <div class="flex flex-wrap gap-1.5 px-6">
        <For each={featured}>
          {(server) => (
            <ConnectorChip
              server={server}
              connected={serverByUrl().has(server.url)}
              authenticated={
                serverByUrl().get(server.url)?.authenticated ?? false
              }
            />
          )}
        </For>
      </div>
    </SettingsSection>
  );
}
