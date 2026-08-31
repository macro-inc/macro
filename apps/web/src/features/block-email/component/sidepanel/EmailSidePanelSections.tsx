import { EntityActivitySectionConditional } from '@app/features/activity/EntityActivitySection';
import {
  EntityPropertiesSection,
  EntityTagsSection,
} from '@app/features/property/side-panel/properties';
import { SidePanel } from '@components/app/side-panel';
import { References } from '@core/component/References';
import { useAttachmentReferencesQuery } from '@queries/storage/attachment-references';
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
      <EntityActivitySectionConditional
        entityId={props.threadId}
        entityType="THREAD"
        order={40}
      />
      <ReferencesSectionConditional threadId={props.threadId} />
    </>
  );
}

function ReferencesSectionConditional(props: { threadId: string }) {
  const references = useAttachmentReferencesQuery(
    () => props.threadId,
    () => 'email'
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
            <References documentId={props.threadId} entityType="email" />
          </div>
        </Suspense>
      </SidePanel.Section>
    </Show>
  );
}
