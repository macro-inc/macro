import { DOCS_BASE } from '@app/constants/docs-links';
import { useAddInboxFlow, useEmailLinksStatus } from '@core/email-link';
import EmptyStateInboxTrayGraphic from '@design/empty-state-inbox-tray.svg';
import EmptyStateNoFilterMatchGraphic from '@design/empty-state-no-filter-match.svg';
import EmptyStateNoSearchMatchGraphic from '@design/empty-state-no-search-match.svg';
import { EmptyStatePanel, FilteredHiddenBanner } from '@ui';
import { Match, Switch } from 'solid-js';
import type { InboxViewState } from '../create-inbox-view-state';

export function InboxEmptyState(props: { state: InboxViewState }) {
  const emailActive = useEmailLinksStatus();
  const startAddInbox = useAddInboxFlow();
  const searchText = () => props.state.search().trim();

  return (
    <Switch>
      <Match when={searchText()}>
        {(search) => (
          <EmptyStatePanel
            centered
            graphic={EmptyStateNoSearchMatchGraphic}
            title={`No results for "${search()}"`}
            description="Search across messages, documents, tasks, and more. Try a different query or broaden your filters."
            documentationUrl={`${DOCS_BASE}/product/search`}
          />
        )}
      </Match>

      <Match when={props.state.activeFacetCount() > 0}>
        <EmptyStatePanel
          centered
          graphic={EmptyStateNoFilterMatchGraphic}
          title="No items matching the filters"
          description="Try adjusting or clearing your filters to see more results."
        >
          <FilteredHiddenBanner
            hasHiddenItems={false}
            onClearFilters={props.state.clearFacets}
          />
        </EmptyStatePanel>
      </Match>

      <Match when={!emailActive()}>
        <EmptyStatePanel
          graphic={EmptyStateInboxTrayGraphic}
          title="Your inbox is empty"
          description="Bring your inbox into Macro to triage signal from noise, reply faster, and let agents work alongside your mail."
          primaryAction={{
            label: 'Connect email',
            onClick: () => void startAddInbox(),
          }}
          documentationUrl={`${DOCS_BASE}/product/inbox`}
        />
      </Match>

      <Match when={props.state.tab() === 'noise'}>
        <EmptyStatePanel
          graphic={EmptyStateInboxTrayGraphic}
          title="No noise"
          description={
            <>
              Low-priority items like newsletters and notifications collect
              here.
              <br />
              Nothing to clear right now.
            </>
          }
          documentationUrl={`${DOCS_BASE}/product/inbox`}
        />
      </Match>

      <Match when={props.state.tab() === 'all'}>
        <EmptyStatePanel
          graphic={EmptyStateInboxTrayGraphic}
          title="Inbox zero"
          description="You're all caught up. New items will appear here as they arrive."
          documentationUrl={`${DOCS_BASE}/product/inbox`}
        />
      </Match>

      <Match when={true}>
        <EmptyStatePanel
          graphic={EmptyStateInboxTrayGraphic}
          title="Inbox zero"
          description="You're all caught up. Important items will appear here as they arrive."
          documentationUrl={`${DOCS_BASE}/product/inbox`}
        />
      </Match>
    </Switch>
  );
}
