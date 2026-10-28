import { EntityDiscussion } from '@core/messages/EntityDiscussion';
import { useCrmUserId as useUserId } from './use-crm';

/** Discussion on a CRM contact, on the shared message components. */
export function ContactDiscussionSection(props: { contactId: string }) {
  const userId = useUserId();
  return (
    <EntityDiscussion
      parent={{ type: 'crm_contact', id: props.contactId }}
      canWrite={!!userId()}
      link={{ type: 'contact', id: props.contactId }}
    />
  );
}
