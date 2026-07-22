import {
  EntityPropertiesSection,
  EntityTagsSection,
} from '@app/features/property/side-panel/properties';
import { SidePanel } from '@components/app/side-panel';
import { References } from '@core/component/References';
import { useAttachmentReferencesQuery } from '@queries/storage/attachment-references';
import type { ItemType } from '@service-storage/client';
import { Show, Suspense } from 'solid-js';
import { useEmailContext } from '../EmailContext';

interface EmailSidePanelSectionsProps {
  threadId: string;
  title: string;
}

export function EmailSidePanelSections(props: EmailSidePanelSectionsProps) {
  const emailCtx = useEmailContext();
  const canEdit = () => emailCtx.permissions().isOwner;

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
      <ReferencesSectionConditional threadId={props.threadId} />
    </>
  );
}

// Email threads are stored as the "thread" entity type in the references
// system (ReferencedShareItemType::EmailThread -> "thread" and the mentions
// plugin maps email -> thread), so query/render with "thread", not "email".
const EMAIL_REFERENCE_ENTITY_TYPE = 'thread' as ItemType;

function ReferencesSectionConditional(props: { threadId: string }) {
  const references = useAttachmentReferencesQuery(
    () => props.threadId,
    () => EMAIL_REFERENCE_ENTITY_TYPE
  );

  const count = () => references.data?.length ?? 0;

  return (
    <Show when={count() > 0}>
      <SidePanel.Section
        id="references"
        title={<SidePanel.CountTitle label="References" count={count()} />}
        order={50}
      >
        <Suspense fallback={<SidePanel.Loading />}>
          <div class="text-xs">
            <References
              documentId={props.threadId}
              entityType={EMAIL_REFERENCE_ENTITY_TYPE}
            />
          </div>
        </Suspense>
      </SidePanel.Section>
    </Show>
  );
}
