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
import { cn, Layer } from '@ui';
import { createMemo, createSignal, For, Match, Switch } from 'solid-js';
import { StatusDot } from '../settings/integration-ui';

/** The connectors onboarding leads with (the ones the builder acts on). */
const SETUP_CONNECTOR_NAMES = ['Linear', 'GitHub', 'Notion', 'Slack'];

/**
 * One connector as its own small card (same chrome as the import panel's
 * source cards): brand icon, name, and an explicit trailing status — a
 * green dot + "Connected" once OAuth has completed, a quiet "Connect"
 * affordance until then (the tagline survives as the hover title).
 * Clicking an unconnected card kicks off add + OAuth in a popup; the server
 * reconciles the moment OAuth completes, and the polled servers query flips
 * the card when the user returns.
 */
function ConnectorRow(props: {
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
    // Open the popup synchronously, while the click's transient activation
    // is still live — opening after the awaited mutations gets rejected by
    // strict popup blockers. The OAuth URL is assigned once it's known;
    // severing `opener` keeps the provider page from reaching back into
    // the app (reverse tabnabbing).
    const popup = window.open('about:blank', '_blank');
    if (popup) popup.opener = null;
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
      if (popup) {
        popup.location.href = result.authorization_url;
      } else {
        // Popup was blocked outright — fall back to a plain open (may
        // still be blocked, but nothing else to try).
        window.open(result.authorization_url, '_blank', 'noopener,noreferrer');
      }
    } catch {
      popup?.close();
      toast.failure(`Failed to connect ${props.server.server_name}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Layer depth={2}>
      <button
        type="button"
        title={
          props.authenticated
            ? `${props.server.server_name} is connected`
            : props.server.tagline
        }
        onClick={() => void handleConnect()}
        class={cn(
          'group flex h-11 w-full items-center gap-2.5 rounded-xl border border-ink/[0.05] bg-surface px-3.5 text-sm',
          'cursor-default outline-none focus-visible:ring-1 focus-visible:ring-accent/50',
          !props.authenticated && 'hover:border-ink/10'
        )}
      >
        <span class="flex size-4 shrink-0 items-center justify-center [&_svg]:size-4">
          <props.server.icon />
        </span>
        <span class="min-w-0 truncate font-medium text-ink">
          {props.server.server_name}
        </span>
        <span class="ml-auto shrink-0">
          <Switch
            fallback={
              <span class="flex items-center gap-1 text-xs font-medium text-ink-muted group-hover:text-ink">
                Connect
                <ArrowUpRightIcon class="size-3 shrink-0" />
              </span>
            }
          >
            <Match when={props.authenticated}>
              <span class="flex items-center gap-1.5 text-xs text-ink-muted">
                <StatusDot state="connected" />
                Connected
              </span>
            </Match>
            <Match when={busy()}>
              <span class="flex items-center gap-1.5 text-xs text-ink-muted">
                <SpinnerIcon class="size-3 shrink-0 animate-spin" />
                Connecting…
              </span>
            </Match>
          </Switch>
        </span>
      </button>
    </Layer>
  );
}

/**
 * The tools half of "connect your work": the core connectors as a column of
 * one-line rows — connected ones read "Connected" with a status dot, the
 * rest are one-click OAuth. Connected tools feed the workspace builder on
 * the right.
 */
export function ConnectorsSection() {
  // Poll: OAuth completes in a popup, and if this window never blurs (or
  // regains focus) no focus-refetch would ever flip the card. neverSuspend
  // keeps the polling query from re-suspending the page's boundary.
  const serversQuery = useMcpServersQuery({
    refetchInterval: 4_000,
    neverSuspend: true,
  });

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
    <section class="flex flex-col gap-3">
      <div class="flex flex-col gap-1">
        <h2 class="text-[15px] font-semibold text-ink">Bring your tools</h2>
        <p class="text-sm text-ink-muted">
          Macro AI works with everything you create in Macro and everything in
          your connected tools. Connect a few integrations, and we'll optionally
          pull in a couple of items from each to get you started.
        </p>
      </div>
      <div class="flex flex-col gap-2">
        <For each={featured}>
          {(server) => (
            <ConnectorRow
              server={server}
              connected={serverByUrl().has(server.url)}
              authenticated={
                serverByUrl().get(server.url)?.authenticated ?? false
              }
            />
          )}
        </For>
      </div>
    </section>
  );
}
