import { useCrmDiscussionSource } from '@companies/Company/crmDiscussionSource';
import { Discussion, DiscussionProvider } from '@core/comments/discussion';
import { CrmCommentEntityType } from '@service-storage/generated/schemas/crmCommentEntityType';

/** Comment discussion for a CRM contact, reusing the shared CRM discussion source. */
export function ContactDiscussionSection(props: { contactId: string }) {
  const source = useCrmDiscussionSource(
    CrmCommentEntityType.crm_contact,
    () => props.contactId
  );
  return (
    <DiscussionProvider source={source}>
      <Discussion />
    </DiscussionProvider>
  );
}
