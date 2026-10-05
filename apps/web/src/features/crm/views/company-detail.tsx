import { SidePanel } from '@components/app/side-panel';
import PlusIcon from '@phosphor/plus.svg';
import { Button } from '@ui';
import { createMemo, Match, Show, Suspense, Switch } from 'solid-js';
import { RecordSection } from '../components/record-section';
import { useCrmContext } from '../context/crm-context';
import type { CrmContact as CompanyContact } from '../core/contact';
import {
  type CompanySection,
  type CrmRecordScope,
  sameRecordScope,
} from '../core/record';
import { CompanyContactsSection } from './company-contacts-section';
import { CompanyDiscussionSection } from './company-discussion-section';
import { CompanyEmailsSection } from './company-emails-section';
import { CompanyHeader } from './company-header';
import { CompanyListsSection } from './company-list-membership';
import { CompanyPropertiesSection } from './company-properties-section';
import { CompanySharingSection } from './company-sharing-section';
import { RecordCallsSection, RecordFilesSection } from './record-associations';
import { useCompanyQuery } from './use-crm';

/**
 * Root of the company detail view, laid out like a project: the host's top
 * bar picks the section, Overview shows the company with its description and
 * discussion, and the other sections list its team, emails, files, tasks and
 * calls. Properties and sharing open in the floating information panel.
 */
export function Company(props: {
  companyId: string;
  section?: CompanySection;
  headerToggle?: boolean;
  onHidden?: () => void;
  onOpenContact?: (contact: CompanyContact) => void;
}) {
  const context = useCrmContext();
  const openCreateContactModal = context.openCreateContact;
  const listsEnabled = context.listsEnabled();
  const { company, contacts } = useCompanyQuery(() => props.companyId);
  const section = () => props.section ?? 'overview';
  const scope = createMemo(
    (): CrmRecordScope | undefined => {
      const current = company();
      if (!current) return;
      return {
        type: 'company',
        id: current.id,
        domains: current.domains.map((domain) => domain.domain),
      };
    },
    undefined,
    { equals: sameRecordScope }
  );

  return (
    <SidePanel.Layout
      headerToggle={props.headerToggle}
      floating
      defaultOpen={false}
    >
      <div class="size-full min-h-0 min-w-0">
        <Switch>
          <Match when={section() === 'overview'}>
            <div class="h-full overflow-y-auto px-6 pb-12 pt-12 scrollbar-hidden touch:pt-6">
              <div class="mx-auto flex max-w-3xl min-w-0 flex-col gap-6">
                <CompanyHeader company={company()} />
                <CompanyDiscussionSection companyId={props.companyId} />
              </div>
            </div>
          </Match>
          <Match when={section() === 'team'}>
            <RecordSection
              title="Team"
              actions={
                <Button
                  variant="ghost"
                  size="sm"
                  // Contact emails are pinned to the company's primary
                  // domain; disabled until the company has loaded.
                  disabled={!company()?.domains[0]}
                  onClick={() => {
                    const domain = company()?.domains[0]?.domain;
                    if (domain) openCreateContactModal(props.companyId, domain);
                  }}
                >
                  <PlusIcon class="size-3.5" />
                  Add contact
                </Button>
              }
            >
              <div class="px-2">
                <CompanyContactsSection
                  company={company()}
                  contacts={contacts()}
                  onOpenContact={props.onOpenContact}
                />
              </div>
            </RecordSection>
          </Match>
          <Match when={section() === 'emails'}>
            <CompanyEmailsSection company={company()} />
          </Match>
          <Match when={section() === 'files'}>
            <RecordFilesSection scope={scope()} />
          </Match>
          <Match when={section() === 'tasks'}>
            <Suspense
              fallback={
                <div class="p-6 text-center text-sm text-ink-muted">
                  Loading…
                </div>
              }
            >
              <Show
                when={scope()}
                fallback={
                  <div class="p-6 text-center text-sm text-ink-muted">
                    Loading…
                  </div>
                }
              >
                {(current) => <context.RecordTasks scope={current()} />}
              </Show>
            </Suspense>
          </Match>
          <Match when={section() === 'calls'}>
            <RecordCallsSection scope={scope()} />
          </Match>
        </Switch>
      </div>

      <SidePanel.Section
        id="company-properties"
        title="Properties"
        order={15}
        defaultOpen
      >
        <CompanyPropertiesSection companyId={props.companyId} />
      </SidePanel.Section>
      <Show when={listsEnabled()}>
        <Suspense>
          <CompanyListsSection companyId={props.companyId} />
        </Suspense>
      </Show>
      <SidePanel.Section id="company-sharing" title="Sharing" order={25}>
        <CompanySharingSection company={company()} onHidden={props.onHidden} />
      </SidePanel.Section>
      {/* TODO: add a References section (inbound channel messages + documents)
          once the references backend supports the crm_company entity type. */}
    </SidePanel.Layout>
  );
}
