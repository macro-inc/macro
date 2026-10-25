import type { CrmCompanyEntity } from '@entity';
import { Tabs } from '@ui';
import { createMemo, createSignal } from 'solid-js';
import { RecordSection } from '../components/record-section';
import type {
  CrmEmailSignal as EmailSignalView,
  CrmEmailScope as EmailView,
} from '../context/crm-sources';
import { RecordItemList } from './record-item-list';
import { useCompanyEmailsQuery } from './use-crm';

export function CompanyEmailsSection(props: { company?: CrmCompanyEntity }) {
  const domains = createMemo(
    () => props.company?.domains.map((domain) => domain.domain) ?? []
  );
  const [search, setSearch] = createSignal('');
  const [view, setView] = createSignal<EmailView>('team');
  const [signalView, setSignalView] = createSignal<EmailSignalView>('all');
  const emailsQuery = useCompanyEmailsQuery(domains, view, signalView);

  const emptyMessage = () => {
    const kind = signalView() === 'signal' ? 'signal emails' : 'emails';
    if (view() === 'me') return `No ${kind} with this company in your inbox.`;
    if (props.company?.emailSync === false) {
      return 'Email sync is disabled for this company.';
    }
    return `No ${kind} with this company yet.`;
  };

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
        pending={!props.company}
        empty={emptyMessage()}
      />
    </RecordSection>
  );
}
