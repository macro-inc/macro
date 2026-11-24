import { EntityPropertiesSection } from '@app/features/property/side-panel/properties/EntityPropertiesSection';
import { TraceFlow, usePending } from '@app/observability/flow';
import { SidePanel } from '@components/app/side-panel';
import { createOpenTracker } from '@core/internal/open-tracker';
import { createMemo, Match, onCleanup, Show, Suspense, Switch } from 'solid-js';
import { CrmAccessFallback } from '../components/access-denied';
import { CrmListSkeleton } from '../components/list-state';
import { RecordOverview } from '../components/record-overview';
import { useCrmContext } from '../context/crm-context';
import { contactEmails } from '../core/contact';
import {
  type ContactSection,
  type CrmRecordScope,
  RECORD_PANEL_ORDER,
  sameRecordScope,
} from '../core/record';
import { ContactDiscussionSection } from './contact-discussion-section';
import { ContactEmailsSection } from './contact-emails-section';
import { ContactHeader } from './contact-header';
import {
  RecordCallsSection,
  RecordFilesSection,
  RecordReferencesSection,
} from './record-associations';
import { RecordDetailsSection } from './record-details-section';
import { useContactQuery, useCrmPermissions } from './use-crm';

/**
 * Root of the contact detail view, laid out like a project: the host's top
 * bar picks the section, Overview shows the contact and its discussion, and
 * the other sections list its emails, files, tasks and calls. Properties and
 * references stay in the floating information panel.
 */
type ContactProps = {
  contactId: string;
  section?: ContactSection;
  headerToggle?: boolean;
  onOpenCompany?: (companyId: string) => boolean;
  onOpenPipeline?: (pipelineId: string) => void;
};

export function Contact(props: ContactProps) {
  const context = useCrmContext();
  return (
    <TraceFlow
      name="crm.contact"
      key={() => `${props.contactId}:${props.section ?? 'overview'}`}
      attributes={{
        'contact.id': props.contactId,
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
        <ContactContent {...props} />
      </Show>
    </TraceFlow>
  );
}

function ContactContent(props: ContactProps) {
  const context = useCrmContext();
  const { canEditCrm } = useCrmPermissions();
  const contactQuery = useContactQuery(() => props.contactId);
  usePending('crm.record', () => contactQuery.isLoading);
  const contact = () => contactQuery.data;
  createOpenTracker('contact', () => contact()?.id);
  onCleanup(
    context.registerTaskComposerRecord(() => ({
      type: 'contact',
      id: props.contactId,
      companyId: contact()?.companyId,
    }))
  );
  const section = () => props.section ?? 'overview';
  const scope = createMemo(
    (): CrmRecordScope | undefined => {
      const current = contact();
      if (!current) return;
      return {
        type: 'contact',
        id: current.id,
        emails: contactEmails(current),
        companyId: current.companyId,
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
                <ContactHeader
                  contact={contact()}
                  onOpenCompany={props.onOpenCompany}
                />
                <context.PipelineEntries
                  record={{ type: 'contact', id: props.contactId }}
                  onOpenPipeline={props.onOpenPipeline}
                />
                <ContactDiscussionSection contactId={props.contactId} />
              </RecordOverview>
            </Match>
            <Match when={section() === 'emails'}>
              <ContactEmailsSection contact={contact()} />
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

      <RecordDetailsSection
        contact={contact()}
        onOpenCompany={props.onOpenCompany}
      />
      <SidePanel.Section
        id="contact-properties"
        title="Properties"
        order={RECORD_PANEL_ORDER.properties}
        defaultOpen
        render={(renderSection) => (
          <EntityPropertiesSection
            entityId={props.contactId}
            entityType="CONTACT"
            canEdit={canEditCrm()}
            renderSection={renderSection}
          />
        )}
      />
      <SidePanel.Section
        id="contact-references"
        title="References"
        order={RECORD_PANEL_ORDER.references}
      >
        <RecordReferencesSection scope={scope()} />
      </SidePanel.Section>
    </SidePanel.Layout>
  );
}
