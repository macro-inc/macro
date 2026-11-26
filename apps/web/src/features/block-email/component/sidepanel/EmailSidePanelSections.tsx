import { EntityActivitySectionConditional } from '@app/features/activity/views/entity-activity-section';
import { useEmailThreadState } from '@app/features/email-thread/context/email-thread-state-context';
import {
  EntityPropertiesSection,
  EntityTagsSection,
} from '@app/features/property/side-panel/properties';
import { SidePanel } from '@components/app/side-panel';
import { EntityMetadata } from '@components/app/side-panel/EntityMetadata';
import { References } from '@core/component/References';
import { LabelChip } from '@property/tags';
import { useShownThreadLabels } from '@queries/email/thread-labels';
import { queryReadyGate } from '@queries/gate';
import { useAttachmentReferencesQuery } from '@queries/storage/attachment-references';
import { For, Show, Suspense } from 'solid-js';

interface EmailSidePanelSectionsProps {
  threadId: string;
  title: string;
}

export function EmailSidePanelSections(props: EmailSidePanelSectionsProps) {
  const emailCtx = useEmailThreadState();
  const canEdit = () => emailCtx.permissions().isOwner;

  return (
    <>
      <EntityTagsSection
        entityId={props.threadId}
        entityType="THREAD"
        canEdit={canEdit()}
        order={20}
      />
      <EmailLabelsSection threadId={props.threadId} />
      <SidePanel.Section
        id="properties"
        title="Properties"
        defaultOpen
        order={30}
        render={(renderSection) => (
          <EntityPropertiesSection
            entityId={props.threadId}
            entityType="THREAD"
            canEdit={canEdit()}
            documentName={props.title}
            propertyFilter={(property) => property.isMetadata !== true}
            showTags={false}
            renderSection={renderSection}
          />
        )}
      />
      <EntityActivitySectionConditional
        entityId={props.threadId}
        entityType="THREAD"
        order={40}
      />
      <ReferencesSectionConditional threadId={props.threadId} />
      <SidePanel.Footer>
        <EntityMetadata
          createdAt={emailCtx.thread()?.created_at}
          updatedAt={emailCtx.thread()?.updated_at}
        />
      </SidePanel.Footer>
    </>
  );
}

/** The thread's labels from its inbox, by their whole names; read-only. */
function EmailLabelsSection(props: { threadId: string }) {
  const labels = useShownThreadLabels(() => props.threadId);
  return (
    <Show when={labels().length > 0}>
      <SidePanel.Section id="labels" title="Labels" defaultOpen order={25}>
        <div class="flex flex-wrap items-center gap-1.5 text-xs">
          <For each={labels()}>
            {(label) => (
              <LabelChip
                name={label.fullName}
                size="sm"
                class="m-px max-w-[30ch]"
              />
            )}
          </For>
        </div>
      </SidePanel.Section>
    </Show>
  );
}

function ReferencesSectionConditional(props: { threadId: string }) {
  const references = useAttachmentReferencesQuery(
    () => props.threadId,
    () => 'email'
  );

  // This condition sits outside the section's Suspense boundary. A pending
  // resource read here would hide the surrounding email view on reconnect.
  const count = () => (queryReadyGate(references) ? references.data.length : 0);

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
