import { EntityPropertiesSection } from '@app/features/property/side-panel/properties';
import {
  DateValueDisplay,
  FolderLink,
  OwnerValue,
  SidePanel,
} from '@components/app/side-panel';
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
      <SidePanel.Section id="details" title="Details" defaultOpen order={10}>
        <Suspense fallback={<SidePanel.Loading />}>
          <ChatDetailsContent chatId={chatId} />
        </Suspense>
      </SidePanel.Section>
      <SidePanel.Section
        id="properties"
        title="Properties"
        defaultOpen
        order={20}
      >
        <Suspense fallback={<SidePanel.Loading />}>
          <ChatPropertiesContent chatId={chatId} canEdit={canEdit()} />
        </Suspense>
      </SidePanel.Section>
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
    <SidePanel.Grid>
      <Show when={chat()?.userId}>
        {(ownerId) => (
          <SidePanel.Row label="Owner">
            <OwnerValue ownerId={ownerId()} />
          </SidePanel.Row>
        )}
      </Show>
      <Show
        when={(() => {
          const id = chat()?.projectId;
          const name = projectQuery.data?.name;
          return id && name ? { id, name } : undefined;
        })()}
      >
        {(folder) => (
          <SidePanel.Row label="Folder">
            <FolderLink projectId={folder().id} projectName={folder().name} />
          </SidePanel.Row>
        )}
      </Show>
      <Show when={chat()?.createdAt}>
        {(created) => (
          <SidePanel.Row label="Created">
            <DateValueDisplay value={created()} />
          </SidePanel.Row>
        )}
      </Show>
      <Show when={chat()?.updatedAt}>
        {(updated) => (
          <SidePanel.Row label="Last updated">
            <DateValueDisplay value={updated()} />
          </SidePanel.Row>
        )}
      </Show>
    </SidePanel.Grid>
  );
}

function ChatPropertiesContent(props: { chatId: string; canEdit: boolean }) {
  const query = useChatDataQuery(() => props.chatId);

  return (
    <EntityPropertiesSection
      entityId={props.chatId}
      entityType="CHAT"
      canEdit={props.canEdit}
      documentName={query.data?.name}
    />
  );
}
