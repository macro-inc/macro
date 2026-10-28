import { SidePanel } from '@components/app/side-panel';
import { createMemo, Match, onCleanup, Show, Suspense, Switch } from 'solid-js';
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
import { ContactSharingSection } from './contact-sharing-section';
import {
  RecordCallsSection,
  RecordFilesSection,
  RecordReferencesSection,
} from './record-associations';
import { useContactQuery, useIsTeamAdmin } from './use-crm';

/**
 * Root of the contact detail view, laid out like a project: the host's top
 * bar picks the section, Overview shows the contact and its discussion, and
 * the other sections list its emails, files, tasks and calls. Sharing and
 * references stay in the floating information panel.
 */
export function Contact(props: {
  contactId: string;
  section?: ContactSection;
  headerToggle?: boolean;
  onOpenCompany?: (companyId: string) => boolean;
  onOpenPipeline?: (pipelineId: string) => void;
}) {
  const context = useCrmContext();
  const pipelinesEnabled = context.pipelinesEnabled();
  const contactQuery = useContactQuery(() => props.contactId);
  const contact = () => contactQuery.data;
  onCleanup(
    context.registerTaskComposerRecord(() => ({
      type: 'contact',
      id: props.contactId,
      companyId: contact()?.companyId,
    }))
  );
  const isTeamAdmin = useIsTeamAdmin();
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
              <Suspense
                fallback={
                  <div class="p-6 text-center text-sm text-ink-muted touch:pt-[calc(var(--mobile-content-inset-top,0px)+1.5rem)]">
                    Loading…
                  </div>
                }
              >
                <Show
                  when={scope()}
                  fallback={
                    <div class="p-6 text-center text-sm text-ink-muted touch:pt-[calc(var(--mobile-content-inset-top,0px)+1.5rem)]">
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

      {/* Sharing is admin-only; hide the whole section for non-admins
          rather than rendering it empty. */}
      <Show when={isTeamAdmin()}>
        <SidePanel.Section id="contact-sharing" title="Sharing" order={25}>
          <ContactSharingSection contact={contact()} />
        </SidePanel.Section>
      </Show>
      <SidePanel.Section id="contact-references" title="References" order={30}>
        <RecordReferencesSection scope={scope()} />
      </SidePanel.Section>
    </SidePanel.Layout>
  );
}
