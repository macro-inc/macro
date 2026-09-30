import { DOCS_BASE } from '@app/constants/docs-links';
import { useAddInboxFlow, useEmailLinksStatus } from '@core/email-link';
import EmptyStateEmailGraphic from '@design/empty-state-email.svg';
import EmptyStateInboxTrayGraphic from '@design/empty-state-inbox-tray.svg';
import EmptyStateNoFilterMatchGraphic from '@design/empty-state-no-filter-match.svg';
import EmptyStateNoSearchMatchGraphic from '@design/empty-state-no-search-match.svg';
import { EmptyStatePanel, FilteredHiddenBanner } from '@ui';
import { type JSXElement, Match, Switch } from 'solid-js';
import { match } from 'ts-pattern';
import { useEmailView } from '../email-view-context';
import { reminderStatusFromFacets } from '../queries/reminder-query';
import type { EmailTab, ReminderStatusFilter } from '../types';
import { useEmailCreateAction } from '../use-email-create-action';

const EMAIL_DOCS_URL = `${DOCS_BASE}/product/email`;

/** A single key, sized to sit inline in a sentence rather than on its own row. */
function HotkeyCap(props: { children: JSXElement }) {
  return (
    <kbd class="rounded border border-edge-muted px-1 py-px font-mono text-xs">
      {props.children}
    </kbd>
  );
}

function tabCopy(tab: EmailTab): { title: string; description: string } {
  return (
    match(tab)
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
      // Reminders have status-specific copy; see `ReminderEmptyState`.
      .with('reminders', () => ({
        title: 'No reminders',
        description: 'Reminders you set will appear here.',
      }))
      .with('all', () => ({
        title: 'No email yet',
        description: 'Everything in your inbox will appear here as it arrives.',
      }))
      .exhaustive()
  );
}

function reminderCopy(status: ReminderStatusFilter): {
  title: string;
  description: JSXElement;
} {
  const howTo = (
    <>
      Set one on anything in Macro by selecting it and pressing{' '}
      <HotkeyCap>h</HotkeyCap>, or write one about nothing in particular.
    </>
  );
  return match(status)
    .with('active', () => ({
      title: 'No active reminders',
      description: (
        <>
          Reminders that have fired wait here until you mark them done. {howTo}
        </>
      ),
    }))
    .with('scheduled', () => ({
      title: 'No scheduled reminders',
      description: (
        <>Reminders you schedule wait here until they fire. {howTo}</>
      ),
    }))
    .with('done', () => ({
      title: 'No done reminders',
      description: 'Reminders you mark done are kept here.',
    }))
    .exhaustive();
}

/**
 * The Reminders tab is not a mailbox: no inbox to connect or select, and its
 * status switch is the tab's whole shape rather than a refinement, so an
 * empty status reads as its own copy rather than "clear your filters".
 */
function ReminderEmptyState() {
  const { state } = useEmailView();
  const createAction = useEmailCreateAction();
  const copy = () => reminderCopy(reminderStatusFromFacets(state.facets));

  return (
    <Switch>
      <Match when={state.search.trim()}>
        {(search) => (
          <EmptyStatePanel
            centered
            graphic={EmptyStateNoSearchMatchGraphic}
            title={`No results for "${search()}"`}
            description="Search across your reminders. Try a different query."
            documentationUrl={`${DOCS_BASE}/product/search`}
          />
        )}
      </Match>
      <Match when={true}>
        <EmptyStatePanel
          graphic={EmptyStateInboxTrayGraphic}
          title={copy().title}
          description={copy().description}
          primaryAction={
            createAction().label === 'New reminder'
              ? { label: 'New reminder', onClick: createAction().run }
              : undefined
          }
          documentationUrl={`${DOCS_BASE}/product/inbox`}
        />
      </Match>
    </Switch>
  );
}

export function EmailEmptyState() {
  const { state, setFacets, setInboxIds } = useEmailView();
  const emailActive = useEmailLinksStatus();
  const startAddInbox = useAddInboxFlow();
  // Scheduled has no search or filters; text typed on another tab stays behind.
  const searchText = () =>
    state.tab === 'scheduled' ? '' : state.search.trim();
  const noInboxesSelected = () => state.inboxIds?.length === 0;
  const hasActiveFilters = () =>
    Object.values(state.facets).some((optionIds) => optionIds.length > 0);

  return (
    <Switch>
      <Match when={state.tab === 'reminders'}>
        <ReminderEmptyState />
      </Match>

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
