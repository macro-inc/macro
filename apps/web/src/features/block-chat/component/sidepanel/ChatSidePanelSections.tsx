import { EntityActivitySectionConditional } from '@app/features/activity/views/entity-activity-section';
import {
  EntityPropertiesSection,
  EntityTagsSection,
} from '@app/features/property/side-panel/properties';
import { FolderLink, SidePanel } from '@components/app/side-panel';
import { EntityMetadata } from '@components/app/side-panel/EntityMetadata';
import { useProjectDataQuery } from '@queries/storage/project-data';
import type { ChatResponse } from '@service-cognition/generated/schemas/chatResponse';
import { Show, Suspense } from 'solid-js';

export function ChatSidePanelSections(props: {
  chatId: string;
  data: ChatResponse;
  canEdit: boolean;
}) {
  const chatId = props.chatId;
  const canEdit = () => props.canEdit;

  return (
    <>
      <SidePanel.Footer>
        <Suspense fallback={<SidePanel.Loading />}>
          <ChatDetailsContent chat={props.data} />
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
      >
        <Suspense fallback={<SidePanel.Loading />}>
          <ChatPropertiesContent chat={props.data} canEdit={canEdit()} />
        </Suspense>
      </SidePanel.Section>
      <EntityActivitySectionConditional
        entityId={chatId}
        entityType="CHAT"
        order={40}
      />
    </>
  );
}

function ChatDetailsContent(props: { chat: ChatResponse }) {
  const chat = () => props.chat;
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
          const name = projectQuery.isSuccess
            ? projectQuery.data?.name
            : undefined;
          return id && name ? { id, name } : undefined;
        })()}
      >
        {(folder) => (
          <div class="flex items-center gap-1">
            Folder
            <FolderLink projectId={folder().id} projectName={folder().name} />
          </div>
        )}
      </Show>
    </EntityMetadata>
  );
}

function ChatPropertiesContent(props: {
  chat: ChatResponse;
  canEdit: boolean;
}) {
  return (
    <EntityPropertiesSection
      entityId={props.chat.id}
      entityType="CHAT"
      canEdit={props.canEdit}
      documentName={props.chat.name}
      showTags={false}
    />
  );
}
