import { DOCS_BASE } from '@app/constants/docs-links';
import { useAddInboxFlow, useEmailLinksStatus } from '@core/email-link';
import { fireAndForget } from '@core/util/fireAndForget';
import EmptyStateEmailGraphic from '@design/empty-state-email.svg';
import EmptyStateInboxTrayGraphic from '@design/empty-state-inbox-tray.svg';
import EmptyStateNoFilterMatchGraphic from '@design/empty-state-no-filter-match.svg';
import EmptyStateNoSearchMatchGraphic from '@design/empty-state-no-search-match.svg';
import { FOCUS_WINDOW_DAYS } from '@queries/email/focus';
import { EmptyStatePanel, FilteredHiddenBanner } from '@ui';
import { Match, Switch } from 'solid-js';
import { match } from 'ts-pattern';
import { canSearchEmailTab } from '../constants';
import { useEmailView } from '../email-view-context';
import { emailSearchScopeLabel } from '../search/email-search-scope';
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
    .with('favorites', () => ({
      title: 'No favorite emails',
      description: 'Star an email to keep it here for easy access.',
    }))
    .with('sent', () => ({
      title: 'No sent email',
      description: 'Email you send will appear here.',
    }))
    .with('scheduled', () => ({
      title: 'No scheduled email',
      description: 'Email you schedule to send later will appear here.',
    }))
    .with('reminders', () => ({
      title: 'No email reminders',
      description: 'Use Remind me on an email to return to it later.',
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
    .with('archived', () => ({
      title: 'No archived email',
      description: 'Email you archive will appear here.',
    }))
    .with('focus', () => ({
      title: "You're caught up",
      description: `Email worth your attention from the last ${FOCUS_WINDOW_DAYS} days appears here.`,
    }))
    .with('spam', () => ({
      title: 'No spam',
      description:
        'Email marked as spam or junk in your connected inboxes appears here.',
    }))
    .with('trash', () => ({
      title: 'Trash is empty',
      description:
        'Deleted email from your connected inboxes appears here until it is permanently removed.',
    }))
    .with('all', () => ({
      title: 'No email yet',
      description: 'Everything in your inbox will appear here as it arrives.',
    }))
    .exhaustive();
}

export function EmailEmptyState() {
  const {
    state,
    parsedSearch,
    setInboxIds,
    setTab,
    filtersChanged,
    clearFilters,
  } = useEmailView();
  const emailActive = useEmailLinksStatus();
  const startAddInbox = useAddInboxFlow();
  // Spam and Trash have no search; text typed on another tab stays behind.
  const searchText = () =>
    canSearchEmailTab(state.tab) ? parsedSearch().query : '';
  const searchedView = () => {
    const scope = parsedSearch().scope;
    return scope ? emailSearchScopeLabel(scope) : undefined;
  };
  const noInboxesSelected = () => state.inboxIds?.length === 0;

  // These states fill the list pane, which is narrow beside the reading pane,
  // so they center in it instead of hugging the sidebar.
  return (
    <Switch>
      <Match when={!emailActive()}>
        <EmptyStatePanel
          centered
          graphic={EmptyStateEmailGraphic}
          title="Connect your email"
          description="Bring your inbox into Macro to triage signal from noise, reply faster, and let agents work alongside your mail."
          primaryAction={{
            label: 'Connect email',
            onClick: () => fireAndForget(startAddInbox(), 'add-inbox'),
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
            title={
              searchedView()
                ? `No results for "${search()}" in ${searchedView()}`
                : `No results for "${search()}"`
            }
            description={
              searchedView()
                ? 'Search all mail by removing the filter, or try a different query.'
                : 'Search covers subjects, senders, and message content in all mail except Spam and Trash. Try a different query.'
            }
            documentationUrl={`${DOCS_BASE}/product/search`}
          />
        )}
      </Match>

      <Match when={filtersChanged()}>
        <EmptyStatePanel
          centered
          graphic={EmptyStateNoFilterMatchGraphic}
          title="No email matching the filters"
          description="Try adjusting or clearing your filters to see more results."
        >
          <FilteredHiddenBanner
            hasHiddenItems={false}
            onClearFilters={clearFilters}
          />
        </EmptyStatePanel>
      </Match>

      <Match when={tabCopy(state.tab)}>
        {(copy) => (
          <EmptyStatePanel
            centered
            graphic={EmptyStateInboxTrayGraphic}
            title={copy().title}
            description={copy().description}
            primaryAction={
              state.tab === 'focus'
                ? {
                    label: 'See the rest of your inbox',
                    onClick: () => setTab('important'),
                  }
                : undefined
            }
            documentationUrl={EMAIL_DOCS_URL}
          />
        )}
      </Match>
    </Switch>
  );
}
