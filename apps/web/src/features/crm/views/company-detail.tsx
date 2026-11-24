import { TraceFlow, usePending } from '@app/observability/flow';
import { SidePanel } from '@components/app/side-panel';
import { createOpenTracker } from '@core/internal/open-tracker';
import { createMemo, Match, onCleanup, Show, Suspense, Switch } from 'solid-js';
import { CompanyDiscussionSection } from '../company-discussion-section';
import { CrmAccessFallback } from '../components/access-denied';
import { CrmListSkeleton } from '../components/list-state';
import { RecordOverview } from '../components/record-overview';
import { useCrmContext } from '../context/crm-context';
import type { CrmContact as CompanyContact } from '../core/contact';
import {
  type CompanySection,
  type CrmRecordScope,
  RECORD_PANEL_ORDER,
  sameRecordScope,
} from '../core/record';
import { CompanyContactsSection } from './company-contacts-section';
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
import { RecordDetailsSection } from './record-details-section';
import { useCompanyQuery } from './use-crm';

/**
 * Root of the company detail view, laid out like a project: the host's top
 * tab row picks the section, Overview shows the company with its description and
 * discussion, and the other sections list its team, emails, files, tasks and
 * calls. Properties, sharing, and references open in the floating
 * information panel.
 */
type CompanyProps = {
  companyId: string;
  section?: CompanySection;
  headerToggle?: boolean;
  onOpenContact?: (contact: CompanyContact) => void;
  onOpenPipeline?: (pipelineId: string) => void;
};

export function Company(props: CompanyProps) {
  const context = useCrmContext();
  return (
    <TraceFlow
      name="crm.company"
      key={() => `${props.companyId}:${props.section ?? 'overview'}`}
      attributes={{
        'company.id': props.companyId,
        'crm.section': props.section ?? 'overview',
      }}
    >
      <Show
        when={context.canAccess()}
        fallback={
          <CrmAccessFallback
            state={context.accessState()}
            onRetry={context.retryAccess}
          />
        }
      >
        <CompanyContent {...props} />
      </Show>
    </TraceFlow>
  );
}

function CompanyContent(props: CompanyProps) {
  const context = useCrmContext();
  onCleanup(
    context.registerTaskComposerRecord(() => ({
      type: 'company',
      id: props.companyId,
    }))
  );
  const listsEnabled = context.listsEnabled();
  const { company, query } = useCompanyQuery(() => props.companyId);
  usePending('crm.record', () => query.isLoading);
  createOpenTracker('company', () => company()?.id);
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
              <RecordOverview>
                <CompanyHeader company={company()} />
                <context.PipelineEntries
                  record={{ type: 'company', id: props.companyId }}
                  onOpenPipeline={props.onOpenPipeline}
                />
                <CompanyDiscussionSection companyId={props.companyId} />
              </RecordOverview>
            </Match>
            <Match when={section() === 'team'}>
              <CompanyContactsSection
                company={company()}
                onOpenContact={props.onOpenContact}
              />
            </Match>
            <Match when={section() === 'emails'}>
              <CompanyEmailsSection company={company()} />
            </Match>
            <Match when={section() === 'files'}>
              <RecordFilesSection scope={scope()} />
            </Match>
            <Match when={section() === 'tasks'}>
              <Suspense fallback={<CrmListSkeleton label="Loading tasks" />}>
                <Show
                  when={scope()}
                  fallback={<CrmListSkeleton label="Loading tasks" />}
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

      <RecordDetailsSection company={company()} />
      <SidePanel.Section
        id="company-properties"
        title="Properties"
        order={RECORD_PANEL_ORDER.properties}
        defaultOpen
        render={(renderSection) => (
          <CompanyPropertiesSection
            companyId={props.companyId}
            renderSection={renderSection}
          />
        )}
      />
      <Show when={listsEnabled()}>
        <Suspense>
          <CompanyListsSection companyId={props.companyId} />
        </Suspense>
      </Show>
      <SidePanel.Section
        id="company-sharing"
        title="Email sharing"
        order={RECORD_PANEL_ORDER.sharing}
      >
        <CompanySharingSection company={company()} />
      </SidePanel.Section>
      <SidePanel.Section
        id="company-references"
        title="References"
        order={RECORD_PANEL_ORDER.references}
      >
        <RecordReferencesSection scope={scope()} />
      </SidePanel.Section>
    </SidePanel.Layout>
  );
}
