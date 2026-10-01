import { TabsInset } from '@core/component/TabsInset';
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
  const [view, setView] = createSignal<EmailView>('team');
  const [signalView, setSignalView] = createSignal<EmailSignalView>('all');
  const emailsQuery = useContactEmailsQuery(email, view, signalView);

  return (
    <RecordSection
      title="Emails"
      actions={
        <>
          <TabsInset
            list={[
              { value: 'signal', label: 'Signal' },
              { value: 'all', label: 'All' },
            ]}
            value={signalView()}
            onChange={(v) => setSignalView(v as EmailSignalView)}
          />
          <TabsInset
            list={[
              { value: 'team', label: 'Team' },
              { value: 'me', label: 'Me' },
            ]}
            value={view()}
            onChange={(v) => setView(v as EmailView)}
          />
        </>
      }
    >
      <RecordItemList
        source={emailsQuery}
        pending={!props.contact}
        empty={`No ${signalView() === 'signal' ? 'signal emails' : 'emails'} with this contact ${view() === 'me' ? 'in your inbox' : 'yet'}.`}
      />
    </RecordSection>
  );
}
