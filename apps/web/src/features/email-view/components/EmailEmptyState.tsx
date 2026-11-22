import { DOCS_BASE } from '@app/constants/docs-links';
import { t } from '@app/lib/i18n';
import { useAddInboxFlow, useEmailLinksStatus } from '@core/email-link';
import { mailboxSizeGuidance } from '@core/email-link/mailbox-health';
import { fireAndForget } from '@core/util/fireAndForget';
import EmptyStateEmailGraphic from '@design/empty-state-email.svg';
import EmptyStateInboxTrayGraphic from '@design/empty-state-inbox-tray.svg';
import EmptyStateNoFilterMatchGraphic from '@design/empty-state-no-filter-match.svg';
import EmptyStateNoSearchMatchGraphic from '@design/empty-state-no-search-match.svg';
import { FOCUS_WINDOW_DAYS } from '@queries/email/focus';
import { useEmailLinksQuery, useInboxSuggestion } from '@queries/email/link';
import { queryReadyGate } from '@queries/gate';
import { EmptyStatePanel, FilteredHiddenBanner, Spinner } from '@ui';
import { Match, Switch } from 'solid-js';
import { match } from 'ts-pattern';
import { canSearchEmailTab } from '../constants';
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
  const { state, setInboxIds, setTab, filtersChanged, clearFilters } =
    useEmailView();
  const emailActive = useEmailLinksStatus();
  const links = useEmailLinksQuery();
  const syncing = () =>
    queryReadyGate(links) &&
    links.data.links.some(
      (link) =>
        link.is_sync_active &&
        !link.needs_reauth &&
        link.sync_status === 'SYNCING' &&
        (state.inboxIds === undefined || state.inboxIds.includes(link.id)) &&
        (!state.aliasFilter || state.aliasFilter.inboxId === link.id)
    );
  const blockedInbox = () => {
    if (!queryReadyGate(links)) return;
    return links.data.links.find(
      (link) =>
        link.is_sync_active &&
        !link.needs_reauth &&
        link.mailbox_issue &&
        (state.inboxIds === undefined || state.inboxIds.includes(link.id)) &&
        (!state.aliasFilter || state.aliasFilter.inboxId === link.id)
    );
  };
  const startAddInbox = useAddInboxFlow();
  const suggestion = useInboxSuggestion(() => !emailActive());
  const offer = () => {
    if (!queryReadyGate(suggestion)) return;
    return match(suggestion.data.offer)
      .with('gmail', 'outlook', 'imap', () => suggestion.data)
      .with('none', () => undefined)
      .exhaustive(() => undefined);
  };
  const connectSuggested = () => {
    const suggested = offer();
    if (!suggested) return startAddInbox();
    return match(suggested.offer)
      .with('gmail', () =>
        startAddInbox({ provider: 'GMAIL', emailAddress: suggested.email })
      )
      .with('outlook', () =>
        startAddInbox({ provider: 'OUTLOOK', emailAddress: suggested.email })
      )
      .with('imap', () =>
        startAddInbox({ provider: 'IMAP', emailAddress: suggested.email })
      )
      .with('none', () => startAddInbox())
      .exhaustive(() => startAddInbox());
  };
  // Scheduled has no search or filters; text typed on another tab stays behind.
  const searchText = () =>
    canSearchEmailTab(state.tab) ? state.search.trim() : '';
  const noInboxesSelected = () => state.inboxIds?.length === 0;

  // These states fill the list pane, which is narrow beside the reading pane,
  // so they center in it instead of hugging the sidebar.
  return (
    <Switch>
      <Match when={!emailActive()}>
        <EmptyStatePanel
          centered
          graphic={EmptyStateEmailGraphic}
          title={offer() ? `Connect ${offer()?.email}` : 'Connect your email'}
          description={
            offer()
              ? 'Read and reply to messages from this inbox in Macro.'
              : 'Bring your inbox into Macro to triage signal from noise, reply faster, and let agents work alongside your mail.'
          }
          primaryAction={{
            label: 'Connect email',
            onClick: () => fireAndForget(connectSuggested(), 'add-inbox'),
          }}
          secondaryAction={
            offer()
              ? {
                  label: 'Use a different account',
                  onClick: () => fireAndForget(startAddInbox(), 'add-inbox'),
                }
              : undefined
          }
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

      <Match when={blockedInbox()}>
        {(inbox) => (
          <div class="h-full w-full" role="status" aria-live="polite">
            <EmptyStatePanel
              centered
              graphic={EmptyStateInboxTrayGraphic}
              title={match(inbox().mailbox_issue)
                .with('snapshot_too_large', () =>
                  t('imap.mailboxTooLargeTitle')
                )
                .otherwise(() => t('imap.mailboxIssue'))}
              description={match(inbox().mailbox_issue)
                .with('snapshot_too_large', () =>
                  mailboxSizeGuidance(inbox().mailbox_retry_at)
                )
                .otherwise(() => t('imap.mailboxIssueDetails'))}
            />
          </div>
        )}
      </Match>

      <Match when={syncing()}>
        <div class="h-full w-full" role="status" aria-live="polite">
          <EmptyStatePanel
            centered
            graphic={EmptyStateInboxTrayGraphic}
            title="Syncing your inbox"
            description="Your existing mail will appear here as it syncs. You can keep using Macro while it finishes."
          >
            <div class="mt-3 flex justify-center">
              <Spinner decorative />
            </div>
          </EmptyStatePanel>
        </div>
      </Match>

      <Match when={searchText()}>
        {(search) => (
          <EmptyStatePanel
            centered
            graphic={EmptyStateNoSearchMatchGraphic}
            title={`No results for "${search()}"`}
            description={
              state.tab === 'focus'
                ? 'Focus search covers subjects, senders, and previews. Try a different query.'
                : 'Search across subjects, senders, and message content. Try a different query.'
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
