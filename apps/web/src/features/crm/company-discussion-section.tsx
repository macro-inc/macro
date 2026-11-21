import { MobileDiscussion } from '@app/components/discussion/mobile-discussion';
import { EntityDiscussion } from '@core/messages/EntityDiscussion';
import { isMobile } from '@core/mobile/isMobile';
import { Show } from 'solid-js';
import { useCrmUserId as useUserId } from './views/use-crm';

/** Discussion on a CRM company, on the shared message components. */
export function CompanyDiscussionSection(props: { companyId: string }) {
  const userId = useUserId();
  return (
    <Show when={props.companyId} keyed>
      {(companyId) => (
        <EntityDiscussion
          parent={{ type: 'crm_company', id: companyId }}
          canWrite={!!userId()}
          link={{ type: 'company', id: companyId }}
          children={
            isMobile()
              ? (conversation) => (
                  <MobileDiscussion
                    conversation={conversation}
                    parent={{ type: 'crm_company', id: companyId }}
                    canWrite={!!userId()}
                  />
                )
              : undefined
          }
        />
      )}
    </Show>
  );
}
