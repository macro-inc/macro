import { pipedreamAppAvailableInEnv } from '@core/component/AI/constant/mcpServers';
import { toast } from '@core/component/Toast/Toast';
import {
  connectPipedreamApp,
  usePipedreamCatalogQuery,
} from '@queries/pipedream-connectors';
import type { PipedreamCatalogEntryResponse } from '@service-cognition/client';
import { type Accessor, createSignal, onCleanup } from 'solid-js';

/** How long typing settles before the catalog is re-queried. */
const SEARCH_DEBOUNCE_MS = 250;

/**
 * Debounced search over the Pipedream app catalog, shared by every surface
 * that offers connectors (the Connections settings page and onboarding's
 * catalog step). Holds the query and the input/committed search split; the
 * caller owns presentation.
 *
 * `exclude` drops entries the surface has already accounted for — the user's
 * existing connections everywhere, plus the connectors that got their own
 * onboarding step, which would otherwise dominate the popularity ranking on
 * the screen right after the user walked past them.
 */
export function createPipedreamCatalogSearch(
  exclude: Accessor<ReadonlySet<string>>
) {
  const [searchInput, setSearchInput] = createSignal('');
  const [search, setSearch] = createSignal('');

  let debounceTimer: ReturnType<typeof setTimeout> | undefined;
  const onSearchInput = (value: string) => {
    setSearchInput(value);
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => setSearch(value), SEARCH_DEBOUNCE_MS);
  };
  onCleanup(() => clearTimeout(debounceTimer));

  const query = usePipedreamCatalogQuery(search);

  const entries = (): PipedreamCatalogEntryResponse[] =>
    (query.data?.pages ?? [])
      .flatMap((page) => page.servers)
      .filter(
        (entry) =>
          pipedreamAppAvailableInEnv(entry.app_slug) &&
          !exclude().has(entry.app_slug)
      );

  return { searchInput, onSearchInput, search, query, entries };
}

/** The two facts connecting needs: which app, and what to call it. */
export type PipedreamConnectableApp = Pick<
  PipedreamCatalogEntryResponse,
  'app_slug' | 'display_name'
>;

/**
 * Connecting one catalog entry through Pipedream's hosted Connect UI, with
 * the toasts every surface wants. Success needs no toast of its own on
 * surfaces that re-render the row as connected, so callers opt in via
 * `onConnected`.
 */
export function createPipedreamCatalogConnect<
  App extends PipedreamConnectableApp,
>(options: {
  entry: Accessor<App>;
  onConnected?: (entry: App) => void;
  /** Where the Connect iframe mounts; see `openPipedreamConnectUI`. */
  container?: Accessor<HTMLElement | undefined>;
}) {
  const [busy, setBusy] = createSignal(false);

  const connect = async () => {
    if (busy()) return;
    const entry = options.entry();
    setBusy(true);
    try {
      const outcome = await connectPipedreamApp({
        appSlug: entry.app_slug,
        serverName: entry.display_name,
        container: options.container?.(),
      });
      if (outcome === 'connected') {
        options.onConnected?.(entry);
      } else if (outcome === 'unsupported') {
        toast.failure('Connectors are not available on this deployment');
      }
    } catch {
      toast.failure(`Failed to connect ${entry.display_name}`);
    } finally {
      setBusy(false);
    }
  };

  return { connect, busy };
}
