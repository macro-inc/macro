import { openCreateContactModal } from '@app/features/companies/CreateContactModal';
import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { SidePanel } from '@components/app/side-panel';
import { enableCrmLists } from '@core/constant/featureFlags';
import PlusIcon from '@phosphor/plus.svg';
import { type CompanyContact, useCompanyQuery } from '@queries/crm/companies';
import { Button } from '@ui';
import { Show, Suspense } from 'solid-js';
import { CompanyListsSection } from '../views/CompanyListsSection';
import { CompanyContactsSection } from './CompanyContactsSection';
import { CompanyDiscussionSection } from './CompanyDiscussionSection';
import { CompanyEmailsSection } from './CompanyEmailsSection';
import { CompanyHeader } from './CompanyHeader';
import { CompanyMetadataSection } from './CompanyMetadataSection';
import { CompanyPropertiesSection } from './CompanyPropertiesSection';
import { CompanySharingSection } from './CompanySharingSection';

/**
 * Root of the company detail view. Owns the company query and pushes the
 * resolved entity down to presentational children. Layout mirrors the task
 * page: middle content constrained to a centered column, additional info in
 * the right-hand SidePanel.
 */
export function Company(props: {
  companyId: string;
  headerToggle?: boolean;
  onHidden?: () => void;
  onOpenContact?: (contact: CompanyContact) => void;
}) {
  const listsFlag = useFeatureFlag(enableCrmLists);
  const { company, contacts } = useCompanyQuery(() => props.companyId);

  return (
    <SidePanel.Layout headerToggle={props.headerToggle}>
      <div class="flex h-full flex-col overflow-y-auto scrollbar-hidden">
        <div class="mx-auto flex w-full max-w-3xl min-w-0 grow flex-col gap-6 px-6 pt-12 pb-12">
          <CompanyHeader company={company()} />
          <CompanyDiscussionSection companyId={props.companyId} />
          <CompanyEmailsSection company={company()} />
        </div>
      </div>

      <SidePanel.Section
        id="company-details"
        title="Details"
        order={10}
        defaultOpen
      >
        <CompanyMetadataSection company={company()} />
      </SidePanel.Section>
      <SidePanel.Section
        id="company-properties"
        title="Properties"
        order={15}
        defaultOpen
      >
        <CompanyPropertiesSection companyId={props.companyId} />
      </SidePanel.Section>
      <Show when={listsFlag().enabled}>
        <Suspense>
          <CompanyListsSection companyId={props.companyId} />
        </Suspense>
      </Show>
      <SidePanel.Section
        id="company-contacts"
        title="Contacts"
        order={20}
        defaultOpen
        actions={
          <Button
            variant="ghost"
            size="icon-sm"
            label="Add contact"
            tooltip="Add contact"
            // Contact emails are pinned to the company's primary domain;
            // disabled until the company (and its domains) has loaded.
            disabled={!company()?.domains[0]}
            onClick={() => {
              const domain = company()?.domains[0]?.domain;
              if (domain) openCreateContactModal(props.companyId, domain);
            }}
          >
            <PlusIcon class="size-3.5" />
          </Button>
        }
      >
        <CompanyContactsSection
          company={company()}
          contacts={contacts()}
          onOpenContact={props.onOpenContact}
        />
      </SidePanel.Section>
      <SidePanel.Section id="company-sharing" title="Sharing" order={25}>
        <CompanySharingSection company={company()} onHidden={props.onHidden} />
      </SidePanel.Section>
      {/* TODO: add a References section (inbound channel messages + documents)
          once the references backend supports the crm_company entity type. */}
    </SidePanel.Layout>
  );
}
