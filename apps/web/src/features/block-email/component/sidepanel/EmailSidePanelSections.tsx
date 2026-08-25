import { EntityActivitySectionConditional } from '@app/features/activity/EntityActivitySection';
import {
  type CorrespondenceParty,
  CorrespondenceSidePanelSection,
  externalParties,
} from '@app/features/correspondence';
import {
  EntityPropertiesSection,
  EntityTagsSection,
} from '@app/features/property/side-panel/properties';
import { SidePanel } from '@components/app/side-panel';
import { EntityReferencesSection } from '@core/component/EntityReferencesSection';
import { useEmail } from '@core/context/user';
import type { ItemType } from '@service-storage/client';
import { createMemo, Suspense } from 'solid-js';
import { useEmailContext } from '../EmailContext';

// Email threads are stored as the "thread" entity type in the references
// system (ReferencedShareItemType::EmailThread -> "thread" and the mentions
// plugin maps email -> thread), so query/render with "thread", not "email".
const EMAIL_REFERENCE_ENTITY_TYPE = 'thread' as ItemType;

interface EmailSidePanelSectionsProps {
  threadId: string;
  title: string;
}

export function EmailSidePanelSections(props: EmailSidePanelSectionsProps) {
  const emailCtx = useEmailContext();
  const canEdit = () => emailCtx.permissions().isOwner;
  const currentUserEmail = useEmail();

  // Everyone visibly on the chain — senders and To/Cc recipients across every
  // message. Bcc is left out: it is deliberately hidden correspondence and
  // doesn't belong in a "who is on this thread" summary.
  const externalThreadParties = createMemo<CorrespondenceParty[]>(() => {
    const messages = emailCtx.thread()?.messages ?? [];
    const participants: CorrespondenceParty[] = [];
    for (const message of messages) {
      if (message.from?.email) {
        participants.push({
          email: message.from.email,
          name: message.from.name ?? undefined,
        });
      }
      for (const contact of [...message.to, ...message.cc]) {
        participants.push({
          email: contact.email,
          name: contact.name ?? undefined,
        });
      }
    }
    return externalParties(participants, currentUserEmail());
  });

  return (
    <>
      <EntityTagsSection
        entityId={props.threadId}
        entityType="THREAD"
        canEdit={canEdit()}
        order={20}
      />
      <SidePanel.Section
        id="properties"
        title="Properties"
        defaultOpen
        order={30}
      >
        <Suspense fallback={<SidePanel.Loading />}>
          <EntityPropertiesSection
            entityId={props.threadId}
            entityType="THREAD"
            canEdit={canEdit()}
            documentName={props.title}
            propertyFilter={(property) => property.isMetadata !== true}
            showTags={false}
          />
        </Suspense>
      </SidePanel.Section>
      <CorrespondenceSidePanelSection
        parties={externalThreadParties()}
        order={35}
      />
      <EntityActivitySectionConditional
        entityId={props.threadId}
        entityType="THREAD"
        order={40}
      />
      <EntityReferencesSection
        entityId={props.threadId}
        entityType={EMAIL_REFERENCE_ENTITY_TYPE}
        order={50}
      />
    </>
  );
}
