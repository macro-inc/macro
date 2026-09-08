import { ViewShell } from '@app/components/view-shell';
import { getViewPreset } from '@app/features/next-soup/sidebar/soup-filter-presets';
import { SoupActiveFiltersBar } from '@app/features/next-soup/soup-view/filters-bar/soup-active-filters-bar';
import { SoupViewContextGroup } from '@app/features/next-soup/soup-view/filters-bar/soup-view-context-group';
import { SoupViewContextSort } from '@app/features/next-soup/soup-view/filters-bar/soup-view-context-sort';
import { SoupSearchbar } from '@app/features/next-soup/soup-view/filters-bar/soup-view-search-bar';
import { UnifiedFilterDropdown } from '@app/features/next-soup/soup-view/filters-bar/unified-filter-dropdown';
import { useFilterRefinements } from '@app/features/next-soup/soup-view/filters-bar/use-filter-refinements';
import { SoupView } from '@app/features/next-soup/soup-view/soup-view';
import { useSoupView } from '@app/features/next-soup/soup-view/soup-view-context';
import { VIEW_TAB_LISTS } from '@app/features/next-soup/soup-view/tab-lists';
import { SplitPanel } from '@components/app/split-panel';
import { onMount } from 'solid-js';
import { EmailSidebar } from './EmailSidebar';

function EmailListHeader() {
  const view = useSoupView();
  const filters = useFilterRefinements();
  // Clear refinements left by the retired inline address controls.
  onMount(() =>
    view.queryFilters.set({
      include: { emailSender: undefined, emailRecipient: undefined },
    })
  );
  const title = () =>
    (view.tagFilter.activeIds().length === 1
      ? view.tagFilter.optionsById().get(view.tagFilter.activeIds()[0])?.label
      : undefined) ??
    VIEW_TAB_LISTS.mail.find(
      (tab) => tab.value === (view.activeTab() ?? 'important')
    )?.label ??
    'Email';
  return (
    <>
      <header class="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-edge-muted px-4">
        <h2 class="min-w-0 truncate text-sm font-semibold text-ink">
          {title()}
        </h2>
        <div class="min-w-0 max-w-80 flex-1">
          <SoupSearchbar
            placeholder="Search mail"
            class="h-9 gap-2 bg-transparent px-3 py-1.5 text-sm focus-within:ring-2 focus-within:ring-accent/20"
          />
        </div>
      </header>
      <div class="relative flex shrink-0 flex-wrap items-center gap-2 px-4 py-2 [&_button]:h-8 [&_button]:gap-2 [&_button]:px-3 [&_button]:text-sm [&_button>svg]:size-3.5">
        <SoupViewContextGroup />
        <UnifiedFilterDropdown hideTags />
        <div class="ml-auto shrink-0">
          <SoupViewContextSort />
        </div>
        <div
          aria-hidden="true"
          class="pointer-events-none absolute -left-2 right-0 bottom-0 border-b border-edge-muted"
        />
      </div>
      <SoupActiveFiltersBar
        filters={filters.consolidatedFiltersList()}
        onClearAll={filters.resetToTabDefaults}
      />
    </>
  );
}

/** Email workspace: mailbox navigation filters the existing email list. */
export function EmailView() {
  const preset = getViewPreset('mail');
  return (
    <SplitPanel.Root>
      <SplitPanel.Body>
        <ViewShell.Root
          resizable
          class="[&_.email-read-row]:opacity-75 [&_.email-read-row:hover]:opacity-100 [&_.email-read-row:focus-within]:opacity-100"
          aside={{ width: 288, min: 224, max: 320 }}
          breakpoints={{ collapsed: 0 }}
          layoutBreakpoint="collapsed"
          main={{ min: 280 }}
        >
          <ViewShell.Aside>
            <EmailSidebar />
          </ViewShell.Aside>
          <ViewShell.Main>
            <SoupView
              viewName="Email"
              initialFilters={preset?.filters}
              initialClientFilters={preset?.clientFilters}
              initialGroupBy={preset?.groupBy}
              header={<EmailListHeader />}
            />
          </ViewShell.Main>
          <div
            aria-hidden="true"
            class="pointer-events-none absolute inset-x-0 top-0 z-10 h-12 border-b border-edge-muted"
          />
        </ViewShell.Root>
      </SplitPanel.Body>
    </SplitPanel.Root>
  );
}
