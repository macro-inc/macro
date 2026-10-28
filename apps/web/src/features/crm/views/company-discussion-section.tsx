import { EntityDiscussion } from '@core/messages/EntityDiscussion';
import { useCrmUserId as useUserId } from './use-crm';

/** Discussion on a CRM company, on the shared message components. */
export function CompanyDiscussionSection(props: { companyId: string }) {
  const userId = useUserId();
  return (
    <EntityDiscussion
      parent={{ type: 'crm_company', id: props.companyId }}
      canWrite={!!userId()}
      link={{ type: 'company', id: props.companyId }}
    />
  );
}
