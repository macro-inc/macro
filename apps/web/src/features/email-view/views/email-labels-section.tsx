import { useEmailLinksContext } from '@core/context/emailLinks';
import { useEmailInboxLabels } from '@queries/email/label-names';
import {
  EMAIL_LABELS_SECTION_ID,
  EmailSidebarLabels,
} from '../components/EmailSidebarLabels';
import { useEmailView } from '../email-view-context';

/**
 * The Labels section of the Mail sidebar: the labels people made in the inboxes
 * the account picker shows, each inbox's as a tree, grouped by inbox when it
 * shows several. A label opens All mail filtered to it. Hidden while there are
 * none.
 */
export function EmailLabelsSection(props: { onNavigate?: () => void }) {
  const {
    state,
    openLabel,
    activeLabelIds,
    isSidebarSectionOpen,
    setSidebarSectionOpen,
  } = useEmailView();
  const labels = useEmailInboxLabels();
  const { links } = useEmailLinksContext();
  return (
    <EmailSidebarLabels
      labels={labels().filter(
        (label) => !state.inboxIds || state.inboxIds.includes(label.linkId)
      )}
      grouped={(state.inboxIds?.length ?? links().length) > 1}
      addressOf={(linkId) =>
        links().find((link) => link.id === linkId)?.email_address ?? ''
      }
      activeIds={activeLabelIds()}
      onSelect={(id) => {
        openLabel(id);
        props.onNavigate?.();
      }}
      open={isSidebarSectionOpen(EMAIL_LABELS_SECTION_ID)}
      onOpenChange={(open) =>
        setSidebarSectionOpen(EMAIL_LABELS_SECTION_ID, open)
      }
    />
  );
}
