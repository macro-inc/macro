import { DOCS_BASE } from '@app/constants/docs-links';
import { useAddInboxFlow, useEmailLinksStatus } from '@core/email-link';
import EmptyStateEmailGraphic from '@design/empty-state-email.svg';
import EmptyStateInboxTrayGraphic from '@design/empty-state-inbox-tray.svg';
import EmptyStateNoFilterMatchGraphic from '@design/empty-state-no-filter-match.svg';
import EmptyStateNoSearchMatchGraphic from '@design/empty-state-no-search-match.svg';
import { EmptyStatePanel, FilteredHiddenBanner } from '@ui';
import { Match, Switch } from 'solid-js';
import { match } from 'ts-pattern';
import { useEmailView } from '../email-view-context';
import type { EmailTab } from '../types';

const EMAIL_DOCS_URL = `${DOCS_BASE}/product/email`;

function tabCopy(tab: EmailTab): { title: string; description: string } {
  return match(tab)
    .with('important', () => ({
      title: 'Inbox zero',
      description:
        "You're all caught up. New email will appear here as it arrives.",
    }))
    .with('noise', () => ({
      title: 'No noise',
      description:
        'Low-priority email like newsletters and notifications collects here. Nothing to clear right now.',
    }))
    .with('sent', () => ({
      title: 'No sent email',
      description: 'Email you send will appear here.',
    }))
    .with('calendar', () => ({
      title: 'No calendar email',
      description: 'Invitations and event updates will appear here.',
    }))
    .with('drafts', () => ({
      title: 'No drafts',
      description: "Email you start but haven't sent will appear here.",
    }))
    .with('shared', () => ({
      title: 'No shared email',
      description: 'Threads teammates share with you will appear here.',
    }))
    .with('all', () => ({
      title: 'No email yet',
      description: 'Everything in your inbox will appear here as it arrives.',
    }))
    .exhaustive();
}

export function EmailEmptyState() {
  const { state, setFacets, setInboxIds } = useEmailView();
  const emailActive = useEmailLinksStatus();
  const startAddInbox = useAddInboxFlow();
  const searchText = () => state.search.trim();
  const noInboxesSelected = () => state.inboxIds?.length === 0;
  const hasActiveFilters = () =>
    Object.values(state.facets).some((optionIds) => optionIds.length > 0);

  return (
    <Switch>
      <Match when={!emailActive()}>
        <EmptyStatePanel
          graphic={EmptyStateEmailGraphic}
          title="Connect your email"
          description="Bring your inbox into Macro to triage signal from noise, reply faster, and let agents work alongside your mail."
          primaryAction={{
            label: 'Connect email',
            onClick: () => void startAddInbox(),
          }}
          documentationUrl={EMAIL_DOCS_URL}
        />
      </Match>

      <Match when={noInboxesSelected()}>
        <EmptyStatePanel
          centered
          graphic={EmptyStateInboxTrayGraphic}
          title="No inboxes selected"
          description="Pick at least one inbox to see its email."
          primaryAction={{
            label: 'Show all inboxes',
            onClick: () => setInboxIds(undefined),
          }}
        />
      </Match>

      <Match when={searchText()}>
        {(search) => (
          <EmptyStatePanel
            centered
            graphic={EmptyStateNoSearchMatchGraphic}
            title={`No results for "${search()}"`}
            description="Search across subjects, senders, and message content. Try a different query."
            documentationUrl={`${DOCS_BASE}/product/search`}
          />
        )}
      </Match>

      <Match when={hasActiveFilters()}>
        <EmptyStatePanel
          centered
          graphic={EmptyStateNoFilterMatchGraphic}
          title="No email matching the filters"
          description="Try adjusting or clearing your filters to see more results."
        >
          <FilteredHiddenBanner
            hasHiddenItems={false}
            onClearFilters={() => setFacets({})}
          />
        </EmptyStatePanel>
      </Match>

      <Match when={tabCopy(state.tab)}>
        {(copy) => (
          <EmptyStatePanel
            graphic={EmptyStateInboxTrayGraphic}
            title={copy().title}
            description={copy().description}
            documentationUrl={EMAIL_DOCS_URL}
          />
        )}
      </Match>
    </Switch>
  );
}
