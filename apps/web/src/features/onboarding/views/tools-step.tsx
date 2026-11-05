import { PipedreamConnectorIcon } from '@core/pipedream/ConnectorIcon';
import { canonicalPipedreamSlug } from '@core/pipedream/slugs';
import { fireAndForget } from '@core/util/fireAndForget';
import GmailIcon from '@icon/gmail-color.svg';
import OutlookIcon from '@icon/outlook-color.svg';
import CaretDownIcon from '@icon/system/regular/caret-down.svg';
import SearchIcon from '@icon/system/regular/magnifying-glass.svg';
import { createEffect, createSignal, For, Show } from 'solid-js';
import { ContinueButton } from '../components/controls';
import {
  SuggestionRow,
  SuggestionRowSkeleton,
} from '../components/suggestion-row';
import { ToolTile } from '../components/tool-tile';
import { type Tool, useOnboardingContext } from '../context/onboarding-context';
import { SUGGESTED_TOOL_LIMIT } from '../core/tools';
import {
  readPendingConnectors,
  savePendingConnectors,
} from '../primitives/flow-storage';
import { createToolSuggestions } from '../primitives/tool-suggestions';
import { orderOnboardingTools } from '../primitives/tools';

/** The busy key for the Add another inbox row. */
const ADD_INBOX = 'add-inbox';

/**
 * Suggests the tools the viewer's inbox shows they use, plus another inbox,
 * above the same searchable catalog and hosted connection flow as Settings.
 */
export function ToolsStep(props: { onContinue: () => void }) {
  const context = useOnboardingContext();
  const catalog = context.createToolCatalog();
  const connected = context.createConnectedTools({ poll: true });
  const suggestions = createToolSuggestions(context);
  const emailAccounts = context.createEmailAccounts();
  const suggestedSlugs = () =>
    (suggestions() ?? []).map((suggestion) =>
      canonicalPipedreamSlug(suggestion.tool.slug)
    );
  const entries = () =>
    orderOnboardingTools(catalog.entries()).filter(
      (tool) => !suggestedSlugs().includes(canonicalPipedreamSlug(tool.slug))
    );
  // Prefer the catalog's entry, which carries the live directory icon.
  const catalogTool = (tool: Tool) =>
    catalog
      .entries()
      .find(
        (entry) =>
          canonicalPipedreamSlug(entry.slug) ===
          canonicalPipedreamSlug(tool.slug)
      ) ?? tool;
  const [browsing, setBrowsing] = createSignal(false);
  const shownSlugs = () => [
    ...suggestedSlugs(),
    ...(browsing() ? entries().map((tool) => tool.slug) : []),
  ];
  let searchInput: HTMLInputElement | undefined;
  const browseAll = () => {
    setBrowsing(true);
    searchInput?.focus();
  };
  const [busy, setBusy] = createSignal<string>();
  // Hosted OAuth finishes out of band, so a connection counts once polling
  // reports a tool this step started connecting. Kept in session storage
  // because GitHub's web OAuth reloads the page before its link lands.
  const [pending, setPending] = createSignal(readPendingConnectors());
  createEffect(() => savePendingConnectors(pending()));
  createEffect(() => {
    const landed = [...pending()].filter((slug) =>
      ['connected', 'account-linked'].includes(connected.state(slug))
    );
    if (landed.length === 0) return;
    for (const slug of landed)
      context.track('onboarding_v4_connector_connected', { connector: slug });
    setPending((set) => new Set([...set].filter((s) => !landed.includes(s))));
  });

  const connect = async (tool: Tool) => {
    if (
      busy() ||
      !['available', 'disabled'].includes(connected.state(tool.slug))
    )
      return;
    setBusy(tool.slug);
    setPending((set) => new Set(set).add(canonicalPipedreamSlug(tool.slug)));
    try {
      await context.connectTool(tool);
    } finally {
      setBusy(undefined);
    }
  };

  const addInbox = async () => {
    if (busy()) return;
    setBusy(ADD_INBOX);
    try {
      await context.connectInbox();
    } finally {
      setBusy(undefined);
    }
  };

  const rowState = (slug: string) => {
    const state = connected.state(slug);
    if (state === 'connected' || state === 'account-linked') return 'connected';
    if (busy() === slug) return 'busy';
    if (state === 'loading' || state === 'error') return 'unavailable';
    return 'available';
  };

  const inboxDetail = () => {
    const accounts = emailAccounts.accounts();
    if (accounts.t !== 'ready' || accounts.value.length === 0) return undefined;
    return accounts.value.length === 1
      ? `${accounts.value[0].address} connected`
      : `${accounts.value.length} inboxes connected`;
  };

  return (
    <div class="flex flex-col gap-7">
      <section aria-labelledby="suggested-tools-heading" class="flex flex-col">
        <h2 id="suggested-tools-heading" class="sr-only">
          Suggested for you
        </h2>
        <p class="mx-auto -mt-2 mb-4 max-w-[600px] text-center text-sm leading-6 text-ink-muted text-balance sm:text-[15px]">
          We recommend connecting your existing tools to Macro now so that the
          background import process (0-2 hours) can start for each tool.
        </p>
        <ul
          aria-label="Suggested connections"
          aria-busy={suggestions() === undefined}
          class="flex flex-col [&>li:not(:first-child)]:border-t [&>li:not(:first-child)]:border-ink/10"
        >
          <SuggestionRow
            pill
            icon={
              <>
                <GmailIcon class="size-5" />
                <OutlookIcon class="size-5" />
              </>
            }
            name="Add another inbox"
            kind="native"
            detail={inboxDetail()}
            reason="Sync another email account into the same inbox, search and agents."
            state={busy() === ADD_INBOX ? 'busy' : 'available'}
            actionLabel="Add"
            actionName="Add another inbox"
            disabled={busy() !== undefined}
            onConnect={() => fireAndForget(addInbox(), 'onboarding')}
          />
          <Show
            when={suggestions()}
            fallback={
              <For each={Array.from({ length: SUGGESTED_TOOL_LIMIT })}>
                {() => <SuggestionRowSkeleton />}
              </For>
            }
          >
            {(list) => (
              <For each={list()}>
                {(suggestion) => (
                  <SuggestionRow
                    icon={
                      <PipedreamConnectorIcon
                        appSlug={suggestion.tool.slug}
                        iconUrl={catalogTool(suggestion.tool).iconUrl}
                        class="size-6"
                      />
                    }
                    name={suggestion.tool.name}
                    kind={suggestion.kind}
                    reason={suggestion.reason}
                    state={rowState(suggestion.tool.slug)}
                    actionLabel={
                      connected.state(suggestion.tool.slug) === 'disabled'
                        ? 'Enable'
                        : 'Connect'
                    }
                    actionName={`${connected.state(suggestion.tool.slug) === 'disabled' ? 'Enable' : 'Connect'} ${suggestion.tool.name}`}
                    connectedLabel={
                      connected.state(suggestion.tool.slug) === 'account-linked'
                        ? 'Account linked'
                        : undefined
                    }
                    disabled={busy() !== undefined}
                    onConnect={() =>
                      fireAndForget(connect(suggestion.tool), 'onboarding')
                    }
                  />
                )}
              </For>
            )}
          </Show>
        </ul>
      </section>
      <Show
        when={browsing()}
        fallback={
          <button
            type="button"
            aria-expanded="false"
            onClick={browseAll}
            class="mx-auto flex items-center gap-1.5 rounded-full px-4 py-2 text-sm text-ink-muted hover:bg-ink/5 hover:text-ink focus-visible:outline-2 focus-visible:outline-ink"
          >
            Browse all integrations
            <CaretDownIcon aria-hidden="true" class="size-3.5" />
          </button>
        }
      >
        <section aria-label="All integrations" class="flex flex-col gap-5">
          <label class="flex items-center gap-3 rounded-full border border-edge bg-input px-5 py-4 shadow-sm focus-within:ring-1 focus-within:ring-ink/30">
            <SearchIcon
              aria-hidden="true"
              class="size-5 shrink-0 text-ink/35"
            />
            <input
              ref={(el) => (searchInput = el)}
              type="search"
              aria-label="Search integrations and MCPs"
              placeholder="Search integrations and MCPs"
              value={catalog.search()}
              onInput={(event) => catalog.setSearch(event.currentTarget.value)}
              class="min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-ink-placeholder"
            />
          </label>
          <div
            role="region"
            aria-label="Available integrations"
            class="px-1 py-1"
          >
            <div class="grid grid-cols-3 gap-x-2 gap-y-5 sm:grid-cols-4">
              <For each={entries()}>
                {(tool) => (
                  <ToolTile
                    tool={tool}
                    busy={busy() === tool.slug}
                    disabled={
                      busy() !== undefined ||
                      ['loading', 'error'].includes(connected.state(tool.slug))
                    }
                    state={connected.state(tool.slug)}
                    onConnect={() => fireAndForget(connect(tool), 'onboarding')}
                  />
                )}
              </For>
            </div>
            <Show when={catalog.failed()}>
              <p role="alert" class="py-6 text-center text-sm text-ink-muted">
                Couldn't load integrations.{' '}
                <button type="button" class="underline" onClick={catalog.retry}>
                  Try again
                </button>
              </p>
            </Show>
            <Show when={catalog.fetching()}>
              <p role="status" class="py-6 text-center text-sm text-ink-muted">
                Loading integrations…
              </p>
            </Show>
            <Show
              when={
                !catalog.fetching() &&
                !catalog.failed() &&
                entries().length === 0 &&
                !catalog.hasMore()
              }
            >
              <p class="py-6 text-center text-sm text-ink-muted">
                No integrations match “{catalog.search()}”. Try another name.
              </p>
            </Show>
            <Show when={catalog.hasMore()}>
              <button
                type="button"
                disabled={catalog.fetching()}
                onClick={catalog.loadMore}
                class="mx-auto block rounded-full border border-edge px-4 py-2 text-sm text-ink-muted disabled:opacity-40"
              >
                Load more
              </button>
            </Show>
          </div>
        </section>
      </Show>
      <Show
        when={shownSlugs().some((slug) => connected.state(slug) === 'error')}
      >
        <p role="alert" class="text-center text-sm text-ink-muted">
          Couldn't check some connections.{' '}
          <button type="button" class="underline" onClick={connected.retry}>
            Retry connection status
          </button>
        </p>
      </Show>
      <Show
        when={
          shownSlugs().includes('github') &&
          connected.state('github') === 'account-linked'
        }
      >
        <p class="text-center text-sm text-ink-muted">
          GitHub account linked. Choose repositories to sync with Macro.{' '}
          <button
            type="button"
            class="underline"
            onClick={context.configureGithubRepositories}
          >
            Configure GitHub repositories
          </button>
        </p>
      </Show>
      <div class="sticky bottom-0 z-10 bg-surface pb-[var(--safe-bottom,0px)]">
        <ContinueButton
          disabled={busy() !== undefined}
          onClick={props.onContinue}
        />
      </div>
    </div>
  );
}
