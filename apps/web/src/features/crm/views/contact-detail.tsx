import { SidePanel } from '@components/app/side-panel';
import { createMemo, type JSX, Match, Show, Suspense, Switch } from 'solid-js';
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
import { RecordCallsSection, RecordFilesSection } from './record-associations';
import { useContactQuery, useIsTeamAdmin } from './use-crm';

/**
 * Root of the contact detail view, laid out like a project: the host's top
 * bar picks the section, Overview shows the contact and its discussion, and
 * the other sections list its emails, files, tasks and calls. Sharing stays
 * in the floating information panel.
 */
export function Contact(props: {
  contactId: string;
  section?: ContactSection;
  headerToggle?: boolean;
  navigation?: JSX.Element;
  onOpenCompany?: (companyId: string) => boolean;
}) {
  const context = useCrmContext();
  const contactQuery = useContactQuery(() => props.contactId);
  const contact = () => contactQuery.data;
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
        {props.navigation}
        <div class="min-h-0 min-w-0 flex-1">
          <Switch>
            <Match when={section() === 'overview'}>
              <div class="h-full overflow-y-auto px-6 pb-12 pt-12 scrollbar-hidden touch:pt-6">
                <div class="mx-auto flex max-w-3xl min-w-0 flex-col gap-6">
                  <ContactHeader
                    contact={contact()}
                    onOpenCompany={props.onOpenCompany}
                  />
                  <ContactDiscussionSection contactId={props.contactId} />
                </div>
              </div>
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

      {/* Sharing is admin-only; hide the whole section for non-admins
          rather than rendering it empty. */}
      <Show when={isTeamAdmin()}>
        <SidePanel.Section id="contact-sharing" title="Sharing" order={25}>
          <ContactSharingSection contact={contact()} />
        </SidePanel.Section>
      </Show>
      {/* TODO: add a References section (inbound channel messages + documents)
          once the references backend supports the crm_contact entity type. */}
    </SidePanel.Layout>
  );
}
