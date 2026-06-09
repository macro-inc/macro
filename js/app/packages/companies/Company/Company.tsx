import { SidePanel } from '@app/component/side-panel';
import { SplitToolbarLeft } from '@app/component/split-layout/components/SplitToolbar';
import { useCompanyQuery } from '@queries/crm/companies';
import { CompanyContactsSection } from './CompanyContactsSection';
import { CompanyDiscussionSection } from './CompanyDiscussionSection';
import { CompanyEmailsSection } from './CompanyEmailsSection';
import { CompanyHeader } from './CompanyHeader';
import { CompanyMetadataSection } from './CompanyMetadataSection';
import { CompanySharingSection } from './CompanySharingSection';

/**
 * Root of the company detail view. Owns the company query and pushes the
 * resolved entity down to presentational children. Layout mirrors the task
 * page: middle content constrained to a centered column, additional info in
 * the right-hand SidePanel.
 */
export function Company(props: { companyId: string }) {
  const { company, contacts } = useCompanyQuery(() => props.companyId);

  return (
    <SidePanel.Layout>
      {/* Narrow-mode Content/Info tabs. Portaled into the split's toolbar
          slot so they sit above the content (and outside the scroll area)
          without restructuring the block's layout. Self-hides in wide
          mode. Mirrors how block-call / block-md mount it. */}
      <SplitToolbarLeft>
        <SidePanel.NarrowTabs />
      </SplitToolbarLeft>
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
        id="company-contacts"
        title="Contacts"
        order={20}
        defaultOpen
      >
        <CompanyContactsSection company={company()} contacts={contacts()} />
      </SidePanel.Section>
      <SidePanel.Section id="company-sharing" title="Sharing" order={25}>
        <CompanySharingSection company={company()} />
      </SidePanel.Section>
      {/* TODO: add a References section (inbound channel messages + documents)
          once the references backend supports the crm_company entity type. */}
    </SidePanel.Layout>
  );
}
