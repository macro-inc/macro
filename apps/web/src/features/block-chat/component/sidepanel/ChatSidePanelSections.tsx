import { EntityActivitySectionConditional } from '@app/features/activity/views/entity-activity-section';
import {
  EntityPropertiesSection,
  EntityTagsSection,
} from '@app/features/property/side-panel/properties';
import { FolderLink, SidePanel } from '@components/app/side-panel';
import {
  EntityMetadata,
  EntityMetadataRow,
} from '@components/app/side-panel/EntityMetadata';
import type { SidePanelSectionLayout } from '@components/app/side-panel/SidePanel';
import { useBlockId } from '@core/block';
import { useCanEdit } from '@core/signal/permissions';
import { useChatDataQuery } from '@queries/cognition/chat-data';
import { useProjectDataQuery } from '@queries/storage/project-data';
import { createMemo, Show, Suspense } from 'solid-js';

export function ChatSidePanelSections() {
  const chatId = useBlockId();
  const canEdit = useCanEdit();

  return (
    <>
      <SidePanel.Footer>
        <Suspense fallback={<SidePanel.Loading />}>
          <ChatDetailsContent chatId={chatId} />
        </Suspense>
      </SidePanel.Footer>
      <EntityTagsSection
        entityId={chatId}
        entityType="CHAT"
        canEdit={canEdit()}
        order={20}
      />
      <SidePanel.Section
        id="properties"
        title="Properties"
        defaultOpen
        order={30}
        render={(renderSection) => (
          <ChatPropertiesContent
            chatId={chatId}
            canEdit={canEdit()}
            renderSection={renderSection}
          />
        )}
      />
      <EntityActivitySectionConditional
        entityId={chatId}
        entityType="CHAT"
        order={40}
      />
    </>
  );
}

function ChatDetailsContent(props: { chatId: string }) {
  const query = useChatDataQuery(() => props.chatId);
  const chat = createMemo(() => query.data);
  const projectQuery = useProjectDataQuery(
    () => chat()?.projectId ?? undefined
  );

  return (
    <EntityMetadata
      ownerId={chat()?.userId}
      createdAt={chat()?.createdAt}
      updatedAt={chat()?.updatedAt}
    >
      <Show
        when={(() => {
          const id = chat()?.projectId;
          const name = projectQuery.data?.name;
          return id && name ? { id, name } : undefined;
        })()}
      >
        {(folder) => (
          <EntityMetadataRow label="Folder">
            <FolderLink projectId={folder().id} projectName={folder().name} />
          </EntityMetadataRow>
        )}
      </Show>
    </EntityMetadata>
  );
}

function ChatPropertiesContent(props: {
  chatId: string;
  canEdit: boolean;
  renderSection: SidePanelSectionLayout;
}) {
  const query = useChatDataQuery(() => props.chatId);

  return (
    <EntityPropertiesSection
      entityId={props.chatId}
      entityType="CHAT"
      canEdit={props.canEdit}
      documentName={query.data?.name}
      showTags={false}
      renderSection={props.renderSection}
    />
  );
}
