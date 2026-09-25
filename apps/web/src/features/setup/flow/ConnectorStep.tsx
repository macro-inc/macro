import { useAnalytics } from '@app/lib/analytics/analytics-context';
import type { FeaturedMcpServer } from '@core/component/AI/constant/mcpServers';
import { usePipedreamMcpFlag } from '@core/pipedream/flag';
import SpinnerIcon from '@phosphor/spinner-gap.svg';
import { useMcpServersQuery } from '@queries/mcp-servers';
import { usePipedreamConnectionsQuery } from '@queries/pipedream-connectors';
import { Layer } from '@ui';
import { createEffect, createMemo, Show } from 'solid-js';
import { ConnectorRow } from '../ConnectorRow';
import { ContinueButton, FeatureList, SkipButton } from './shared';

/** One connector per page. OAuth runs in a popup; the polled servers query
 * flips the card, and the server starts an auto-importing gather on it. */
export function ConnectorStep(props: {
  server: FeaturedMcpServer;
  /** What connecting actually does, one row per point. */
  features: string[];
  /** Shown once connected — what happens behind the scenes ("we're already
   * looking through your Linear…"). Omit for connect-only tools (GitHub). */
  gatherHint?: string;
  onContinue: () => void;
  onSkip: () => void;
}) {
  // Poll: OAuth completes in a popup, and if this window never blurs no
  // focus-refetch would ever flip the step.
  const pipedreamMcp = usePipedreamMcpFlag();
  const serversQuery = useMcpServersQuery({
    refetchInterval: 4_000,
    neverSuspend: true,
  });
  const pipedreamQuery = usePipedreamConnectionsQuery({
    refetchInterval: 4_000,
    neverSuspend: true,
  });
  const record = createMemo(() =>
    serversQuery.data?.find((server) => server.url === props.server.url)
  );
  const pipedreamRecord = createMemo(() =>
    pipedreamQuery.data?.find(
      (connection) => connection.app_slug === props.server.app_slug
    )
  );
  const authenticated = () =>
    pipedreamMcp()
      ? pipedreamRecord() !== undefined
      : (record()?.authenticated ?? false);

  const analytics = useAnalytics();
  let wasAuthenticated: boolean | undefined;
  createEffect(() => {
    if (
      pipedreamMcp()
        ? pipedreamQuery.isPlaceholderData
        : serversQuery.isPlaceholderData
    )
      return;
    const authed = authenticated();
    if (wasAuthenticated === false && authed) {
      analytics.track('onboarding_v4_connector_connected', {
        connector: props.server.server_name.toLowerCase(),
      });
    }
    wasAuthenticated = authed;
  });

  return (
    <div class="flex flex-col gap-3">
      {/* On the placeholder, an already-connected server would render as
          unconnected and clickable (duplicate add + pointless popup). */}
      <Show
        when={
          pipedreamMcp()
            ? !pipedreamQuery.isPlaceholderData
            : !serversQuery.isPlaceholderData
        }
        fallback={
          <Layer depth={2}>
            <div class="flex h-11 w-full items-center gap-2.5 rounded-xl border border-ink/[0.05] bg-surface px-3.5 text-sm">
              <span class="flex size-4 shrink-0 items-center justify-center [&_svg]:size-4">
                <props.server.icon />
              </span>
              <span class="min-w-0 truncate font-medium text-ink">
                {props.server.server_name}
              </span>
              <span class="ml-auto flex shrink-0 items-center gap-1.5 text-xs text-ink-muted">
                <SpinnerIcon class="size-3 shrink-0 animate-spin" />
                Checking…
              </span>
            </div>
          </Layer>
        }
      >
        <ConnectorRow
          server={props.server}
          connected={
            pipedreamMcp()
              ? pipedreamRecord() !== undefined
              : record() !== undefined
          }
          authenticated={authenticated()}
        />
      </Show>

      <FeatureList features={props.features} />

      <Show
        when={authenticated()}
        fallback={<SkipButton onClick={props.onSkip} />}
      >
        <Show when={props.gatherHint}>
          <p class="text-xs leading-snug text-ink-muted">{props.gatherHint}</p>
        </Show>
        <ContinueButton onClick={props.onContinue} />
      </Show>
    </div>
  );
}
