import { Discussion, DiscussionProvider } from '@core/comments/discussion';
import { CrmCommentEntityType } from '@service-storage/generated/schemas/crmCommentEntityType';
import { useCrmDiscussionSource } from './crmDiscussionSource';

/** Comment discussion for a CRM company, reusing the shared discussion UI. */
export function CompanyDiscussionSection(props: { companyId: string }) {
  const source = useCrmDiscussionSource(
    CrmCommentEntityType.crm_company,
    () => props.companyId
  );
  return (
    <DiscussionProvider source={source}>
      <Discussion />
    </DiscussionProvider>
  );
}
