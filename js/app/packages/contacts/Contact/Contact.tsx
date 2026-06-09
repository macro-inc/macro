import { SidePanel } from '@app/component/side-panel';
import { SplitToolbarLeft } from '@app/component/split-layout/components/SplitToolbar';
import { useContactQuery } from '@queries/crm/contacts';
import { useIsTeamAdmin } from '@queries/team/teams';
import { Show } from 'solid-js';
import { ContactDiscussionSection } from './ContactDiscussionSection';
import { ContactEmailsSection } from './ContactEmailsSection';
import { ContactHeader } from './ContactHeader';
import { ContactMetadataSection } from './ContactMetadataSection';
import { ContactSharingSection } from './ContactSharingSection';

/**
 * Root of the contact detail view. Owns the contact query and pushes the
 * resolved entity down to presentational children. Layout mirrors the
 * company block: middle content constrained to a centered column,
 * additional info in the right-hand SidePanel, Content/Info pill tabs
 * in narrow mode via SplitToolbarLeft.
 */
export function Contact(props: { contactId: string }) {
  const contactQuery = useContactQuery(() => props.contactId);
  const contact = () => contactQuery.data;
  const isTeamAdmin = useIsTeamAdmin();

  return (
    <SidePanel.Layout>
      <SplitToolbarLeft>
        <SidePanel.NarrowTabs />
      </SplitToolbarLeft>
      <div class="flex h-full flex-col overflow-y-auto scrollbar-hidden">
        <div class="mx-auto flex w-full max-w-3xl min-w-0 grow flex-col gap-6 px-6 pt-12 pb-12">
          <ContactHeader contact={contact()} />
          <ContactDiscussionSection contactId={props.contactId} />
          <ContactEmailsSection contact={contact()} />
        </div>
      </div>

      <SidePanel.Section
        id="contact-details"
        title="Details"
        order={10}
        defaultOpen
      >
        <ContactMetadataSection contact={contact()} />
      </SidePanel.Section>
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
