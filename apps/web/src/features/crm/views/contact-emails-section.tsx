import { Tabs } from '@ui';
import { createSignal } from 'solid-js';
import { RecordSection } from '../components/record-section';
import type {
  CrmEmailSignal as EmailSignalView,
  CrmEmailScope as EmailView,
} from '../context/crm-sources';
import type { CrmContact as CrmContactResponse } from '../core/contact';
import { RecordItemList } from './record-item-list';
import { useContactEmailsQuery } from './use-crm';

export function ContactEmailsSection(props: { contact?: CrmContactResponse }) {
  const email = () => props.contact?.email;
  const [search, setSearch] = createSignal('');
  const [view, setView] = createSignal<EmailView>('team');
  const [signalView, setSignalView] = createSignal<EmailSignalView>('all');
  const emailsQuery = useContactEmailsQuery(email, view, signalView);

  return (
    <RecordSection
      title="Emails"
      search={search()}
      onSearchChange={setSearch}
      actions={
        <>
          <Tabs
            aria-label="Email importance"
            size="sm"
            touch="inset"
            options={[
              { value: 'signal', label: 'Signal' },
              { value: 'all', label: 'All' },
            ]}
            value={signalView()}
            onChange={setSignalView}
          />
          <Tabs
            aria-label="Email inboxes"
            size="sm"
            touch="inset"
            options={[
              { value: 'team', label: 'Team' },
              { value: 'me', label: 'Me' },
            ]}
            value={view()}
            onChange={setView}
          />
        </>
      }
    >
      <RecordItemList
        source={emailsQuery}
        search={search()}
        pending={!props.contact}
        empty={`No ${signalView() === 'signal' ? 'signal emails' : 'emails'} with this contact ${view() === 'me' ? 'in your inbox' : 'yet'}.`}
      />
    </RecordSection>
  );
}
