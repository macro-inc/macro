import EmptyStateEmailGraphic from '@design/empty-state-email.svg';
import { Tabs } from '@ui';
import { createSignal } from 'solid-js';
import { CrmListEmpty } from '../components/list-state';
import {
  RecordSection,
  RecordSectionFilters,
} from '../components/record-section';
import { useCrmContext } from '../context/crm-context';
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
  const crm = useCrmContext();
  const [view, setView] = createSignal<EmailView>('team');
  const [signalView, setSignalView] = createSignal<EmailSignalView>('all');
  const emailsQuery = useContactEmailsQuery(email, view, signalView);

  return (
    <RecordSection
      title="Emails"
      search={search()}
      onSearchChange={setSearch}
      createAction={{
        label: 'New email',
        onClick: () => crm.openEmailComposer(props.contact?.email),
      }}
      actions={
        <RecordSectionFilters
          activeCount={
            Number(signalView() !== 'all') + Number(view() !== 'team')
          }
          onClear={() => {
            setSignalView('all');
            setView('team');
          }}
        >
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
        </RecordSectionFilters>
      }
    >
      <RecordItemList
        source={emailsQuery}
        search={search()}
        pending={!props.contact}
        onClearSearch={() => setSearch('')}
        emptyContent={
          <CrmListEmpty
            graphic={EmptyStateEmailGraphic}
            title={`No ${signalView() === 'signal' ? 'signal emails' : 'emails'} with this contact ${view() === 'me' ? 'in your inbox' : 'yet'}.`}
            description="Email this contact to start a conversation."
            action={{
              label: 'New email',
              onClick: () => crm.openEmailComposer(props.contact?.email),
            }}
          />
        }
      />
    </RecordSection>
  );
}
