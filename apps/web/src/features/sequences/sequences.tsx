import { crmSequenceContent } from '@app/features/crm/crm-hosted-content';
import {
  useCrmCompanyPeople,
  useCrmPeopleSearch,
} from '@app/features/crm/record-adapter';
import { useSplitLayout } from '@components/app/split-layout/layout';
import { toast } from '@core/component/Toast/Toast';
import { useUserId } from '@core/context/user';
import { getDisplayName, tryMacroId } from '@core/user';
import { useEmailLinksQuery } from '@queries/email/link';
import { queryReadyGate } from '@queries/gate';
import { type ComponentProps, type ParentProps, Show } from 'solid-js';
import { addToSequenceDialog } from './add-to-sequence';
import {
  type SendersSource,
  SequencesProvider,
} from './context/sequences-context';
import { ownGmailSenders, SEQUENCE_LIMITS } from './core/sequence';
import {
  createContactEnrollments,
  createEnroller,
  createEnrollmentCommands,
  createSequence,
  createSequenceList,
} from './queries/sources';
import { ContactSequencesView } from './views/contact-sequences';
import { EnrollView } from './views/enroll';
import { SequencesNavView } from './views/sequences-nav';
import { SequencesPane as SequencesPaneView } from './views/sequences-pane';

function AppSequences(props: ParentProps) {
  const userId = useUserId();
  function createSenders(): SendersSource {
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
  return (
    <SequencesProvider
      value={{
        createSequenceList,
        createSequence,
        createEnrollmentCommands,
        // CRM's own People search, the one its pickers and mentions use.
        createPeople: (search) =>
          useCrmPeopleSearch(search, SEQUENCE_LIMITS.contacts),
        createCompanyPeople: (companyIds) =>
          useCrmCompanyPeople(companyIds, SEQUENCE_LIMITS.contacts + 1),
        createEnroller,
        createSenders,
        createContactEnrollments,
        userId,
        userName: (id) => getDisplayName(tryMacroId(id)),
        feedback: toast,
      }}
    >
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

/** The "Add to sequence" dialog for selected people and companies, mounted by the app shell. */
export function AddToSequenceHost() {
  return (
    <Show when={addToSequenceDialog.request()} keyed>
      {(request) => (
        <AppSequences>
          <EnrollView
            initial={request.people}
            companyIds={request.companyIds}
            onClose={addToSequenceDialog.close}
          />
        </AppSequences>
      )}
    </Show>
  );
}
