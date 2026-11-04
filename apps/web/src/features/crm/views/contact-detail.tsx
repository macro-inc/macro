import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { TraceFlow, usePending } from '@app/observability/flow';
import { SidePanel } from '@components/app/side-panel';
import { enableSequences } from '@core/constant/featureFlags';
import { createMemo, Match, onCleanup, Show, Suspense, Switch } from 'solid-js';
import { CrmListSkeleton } from '../components/list-state';
import { RecordOverview } from '../components/record-overview';
import { useCrmContext } from '../context/crm-context';
import {
  type ContactSection,
  type CrmRecordScope,
  sameRecordScope,
} from '../core/record';
import { ContactDiscussionSection } from './contact-discussion-section';
import { ContactEmailsSection } from './contact-emails-section';
import { ContactHeader } from './contact-header';
import {
  RecordCallsSection,
  RecordDatabasesSection,
  RecordFilesSection,
  RecordReferencesSection,
} from './record-associations';
import { useContactQuery } from './use-crm';

/**
 * Root of the contact detail view, laid out like a project: the host's top
 * bar picks the section, Overview shows the contact and its discussion, and
 * the other sections list its emails, files, tasks and calls. References
 * stay in the floating information panel.
 */
type ContactProps = {
  contactId: string;
  section?: ContactSection;
  headerToggle?: boolean;
  onOpenCompany?: (companyId: string) => boolean;
  onOpenPipeline?: (pipelineId: string) => void;
};

export function Contact(props: ContactProps) {
  return (
    <TraceFlow
      name="crm.contact"
      key={() => `${props.contactId}:${props.section ?? 'overview'}`}
      attributes={{
        'contact.id': props.contactId,
        'crm.section': props.section ?? 'overview',
      }}
    >
      <ContactContent {...props} />
    </TraceFlow>
  );
}

function ContactContent(props: ContactProps) {
  const context = useCrmContext();
  const pipelinesEnabled = context.pipelinesEnabled();
  const sequencesFlag = useFeatureFlag(enableSequences);
  const contactQuery = useContactQuery(() => props.contactId);
  usePending('crm.record', () => contactQuery.isLoading);
  const contact = () => contactQuery.data;
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
        email: current.email,
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
                <Show when={pipelinesEnabled()}>
                  <context.PipelineEntries
                    record={{ type: 'contact', id: props.contactId }}
                    onOpenPipeline={props.onOpenPipeline}
                  />
                </Show>
                <Show when={sequencesFlag().enabled}>
                  <Suspense>
                    <context.ContactSequences contactId={props.contactId} />
                  </Suspense>
                </Show>
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
            <Match when={section() === 'databases'}>
              <RecordDatabasesSection scope={scope()} />
            </Match>
            <Match when={section() === 'calls'}>
              <RecordCallsSection scope={scope()} />
            </Match>
          </Switch>
        </div>
      </div>

      <SidePanel.Section id="contact-references" title="References" order={30}>
        <RecordReferencesSection scope={scope()} />
      </SidePanel.Section>
    </SidePanel.Layout>
  );
}
