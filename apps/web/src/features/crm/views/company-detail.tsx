import { SidePanel } from '@components/app/side-panel';
import PlusIcon from '@icon/system/regular/plus.svg';
import { Button } from '@ui';
import { createMemo, Match, Show, Suspense, Switch } from 'solid-js';
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
import {
  RecordCallsSection,
  RecordFilesSection,
  RecordReferencesSection,
} from './record-associations';
import { useCompanyQuery } from './use-crm';

/**
 * Root of the company detail view, laid out like a project: the host's top
 * tab row picks the section, Overview shows the company with its description and
 * discussion, and the other sections list its team, emails, files, tasks and
 * calls. Properties, sharing, and references open in the floating
 * information panel.
 */
export function Company(props: {
  companyId: string;
  section?: CompanySection;
  headerToggle?: boolean;
  onHidden?: () => void;
  onOpenContact?: (contact: CompanyContact) => void;
  onOpenPipeline?: (pipelineId: string) => void;
}) {
  const context = useCrmContext();
  const openCreateContactModal = context.openCreateContact;
  const listsEnabled = context.listsEnabled();
  const pipelinesEnabled = context.pipelinesEnabled();
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
      <div class="flex size-full min-h-0 min-w-0 flex-col">
        <div class="min-h-0 min-w-0 flex-1">
          <Switch>
            <Match when={section() === 'overview'}>
              <div class="h-full overflow-y-auto px-6 pb-12 pt-12 scrollbar-hidden touch:pt-6">
                <div class="mx-auto flex max-w-3xl min-w-0 flex-col gap-6">
                  <CompanyHeader company={company()} />
                  <Show when={pipelinesEnabled()}>
                    <context.PipelineEntries
                      record={{ type: 'company', id: props.companyId }}
                      onOpenPipeline={props.onOpenPipeline}
                    />
                  </Show>
                  <CompanyDiscussionSection companyId={props.companyId} />
                </div>
              </div>
            </Match>
            <Match when={section() === 'team'}>
              <CompanyContactsSection
                company={company()}
                contacts={contacts()}
                onOpenContact={props.onOpenContact}
                actions={
                  <Button
                    variant="outline"
                    // Contact emails are pinned to the company's primary
                    // domain; disabled until the company has loaded.
                    disabled={!company()?.domains[0]}
                    onClick={() => {
                      const domain = company()?.domains[0]?.domain;
                      if (domain)
                        openCreateContactModal({
                          companyId: props.companyId,
                          domain,
                        });
                    }}
                  >
                    <PlusIcon class="size-4" />
                    Add contact
                  </Button>
                }
              />
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
      <SidePanel.Section id="company-references" title="References" order={30}>
        <RecordReferencesSection scope={scope()} />
      </SidePanel.Section>
    </SidePanel.Layout>
  );
}
