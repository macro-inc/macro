import { crmSequenceContent } from '@app/features/crm/crm-hosted-content';
import { useCrmPeopleSearch } from '@app/features/crm/record-adapter';
import { useSplitLayout } from '@components/app/split-layout/layout';
import { toast } from '@core/component/Toast/Toast';
import { useUserId } from '@core/context/user';
import { getDisplayName, tryMacroId } from '@core/user';
import { useEmailLinksQuery } from '@queries/email/link';
import { queryReadyGate } from '@queries/gate';
import {
  type Accessor,
  type ComponentProps,
  createMemo,
  type ParentProps,
  Show,
} from 'solid-js';
import { addToSequenceDialog } from './add-to-sequence';
import {
  type PeopleSource,
  type SendersSource,
  type SequencesContext,
  SequencesProvider,
} from './context/sequences-context';
import { ownGmailSenders, SEQUENCE_LIMITS } from './core/sequence';
import {
  createContactEnrollments,
  createEnroller,
  createEnrollment,
  createEnrollmentCommands,
  createSequence,
  createSequenceList,
} from './queries/sources';
import { ContactSequencesView } from './views/contact-sequences';
import { EnrollView } from './views/enroll';
import { SequencesNavView } from './views/sequences-nav';
import { SequencesPane as SequencesPaneView } from './views/sequences-pane';

function createSenders(): SendersSource {
  const userId = useUserId();
  const links = useEmailLinksQuery();
  return {
    senders: () => {
      const user = userId();
      return user && queryReadyGate(links)
        ? ownGmailSenders(links.data.links, user)
        : [];
    },
    pending: () => links.isPending,
  };
}

/** CRM's own People search, the one its pickers and mentions use. */
function createPeople(search: Accessor<string>): PeopleSource {
  const results = useCrmPeopleSearch(search, SEQUENCE_LIMITS.contacts);
  // Mapped once per result, so the picker's rows keep their identity.
  const people = createMemo(() =>
    results.people().map((person) => ({
      id: person.id,
      name: person.name,
      email: person.email,
    }))
  );
  return {
    people,
    pending: results.pending,
    failed: results.failed,
  };
}

function createAppSequencesContext(): SequencesContext {
  return {
    createSequenceList,
    createSequence,
    createEnrollment,
    createEnrollmentCommands,
    createPeople,
    createEnroller,
    createSenders,
    createContactEnrollments,
    userName: (userId) => getDisplayName(tryMacroId(userId)),
    feedback: toast,
  };
}

function AppSequences(props: ParentProps) {
  return (
    <SequencesProvider value={createAppSequencesContext()}>
      {props.children}
    </SequencesProvider>
  );
}

/** The Customers sidebar entry. */
export function SequencesNav(props: ComponentProps<typeof SequencesNavView>) {
  return (
    <AppSequences>
      <SequencesNavView {...props} />
    </AppSequences>
  );
}

/** The Customers main pane for the Sequences section. */
export function SequencesPane(props: ComponentProps<typeof SequencesPaneView>) {
  return (
    <AppSequences>
      <SequencesPaneView {...props} />
    </AppSequences>
  );
}

/** A contact's sequences on its Overview; the owner's open in Customers. */
export function ContactSequences(props: { contactId: string }) {
  const { openWithSplit } = useSplitLayout();
  return (
    <AppSequences>
      <ContactSequencesView
        contactId={props.contactId}
        onOpenSequence={(sequenceId) =>
          openWithSplit(crmSequenceContent(sequenceId), {
            activate: true,
            allowDuplicate: true,
          })
        }
      />
    </AppSequences>
  );
}

/** The "Add to sequence" dialog for selected People, mounted by the app shell. */
export function AddToSequenceHost() {
  return (
    <Show when={addToSequenceDialog.people()} keyed>
      {(people) => (
        <AppSequences>
          <EnrollView initial={people} onClose={addToSequenceDialog.close} />
        </AppSequences>
      )}
    </Show>
  );
}
