import type { EntityDragData, EntityDragEvent } from '../types/drag';
import {
  createCopyDssEntityMutation,
  createMoveToProjectDssEntityMutation,
} from '../queries/dss';
import { createDroppable, useDragDropContext } from '@thisbeyond/solid-dnd';
import { createMemo, Show } from 'solid-js';
import { FileDropOverlay } from '@core/component/FileDropOverlay';

export type ProjectDropData = {
  dropType: 'project';
  id: string;
};

export const ProjectDropOverlay = (props: {
  projectId: string;
  name?: string;
  splitId?: string;
}) => {
  const [state, { onDragEnd }] = useDragDropContext() ?? [
    undefined,
    {
      onDragEnd: () => {},
    },
  ];

  const moveMutation = createMoveToProjectDssEntityMutation();
  const copyMutation = createCopyDssEntityMutation();

  onDragEnd((event: EntityDragEvent) => {
    const droppable = event.droppable;
    if (
      !droppable ||
      droppable.id !== props.projectId ||
      droppable.data?.dropType !== 'project'
    )
      return;

    const dropData = droppable.data as ProjectDropData;
    const targetProjectId = dropData.id;

    const draggable = event.draggable;
    if (!draggable?.data) return;

    const entityData = draggable.data;

    // ignore drag and drop within same split
    if (entityData.splitId === props.splitId) return;

    switch (entityData.operation()) {
      case 'copy':
        if (entityData.type !== 'document' && entityData.type !== 'chat') {
          console.error('copy only supported for document and chat');
          return;
        }
        copyMutation.mutate(
          {
            entity: entityData,
          },
          {
            onSuccess: (id: string) => {
              // TODO: add project id as an argument to backend copy endpoint
              // so we don't need multiple calls to copy and move
              moveMutation.mutate({
                entity: {
                  ...entityData,
                  id,
                },
                project: {
                  id: targetProjectId,
                },
              });
            },
          }
        );
        break;
      case 'move':
        if (
          entityData.type !== 'document' &&
          entityData.type !== 'chat' &&
          entityData.type !== 'project'
        ) {
          console.error('move only supported for document, chat, and project');
          return;
        }
        moveMutation.mutate({
          entity: entityData,
          project: {
            id: targetProjectId,
          },
        });
        break;
    }
  });

  const entityDragData = createMemo(() => {
    const draggable = state?.active.draggable;
    if (!draggable) return;
    const dragData = draggable.data;
    if (!dragData || dragData.dragType !== 'entity') return;
    return dragData as EntityDragData;
  });

  const showProjectOverlay = createMemo(() => {
    const dragData = entityDragData();
    if (!dragData) return false;

    const entityType = dragData.type;
    if (
      entityType !== 'document' &&
      entityType !== 'chat' &&
      entityType !== 'project'
    ) {
      return false;
    }

    // Don't show overlay if dragging within the same split
    if (props.splitId && dragData.splitId === props.splitId) return false;

    const activeDroppable = state?.active.droppable;

    if (!activeDroppable || activeDroppable.data.dropType !== 'project')
      return false;

    // Show overlay if dropping on this project or an entity within it
    if (activeDroppable.id === props.projectId) return true;

    return false;
  });

  const dropActionText = createMemo(() => {
    switch (entityDragData()?.operation?.()) {
      case 'copy':
        return 'Copy to this folder';
      case 'move':
        return 'Move to this folder';
    }
  });

  return (
    <>
      <Show when={props.projectId} keyed>
        {(projectId) => {
          const data: ProjectDropData = {
            dropType: 'project',
            id: projectId,
          };
          const droppable = createDroppable(props.projectId, data);
          false && droppable;

          return (
            <div
              use:droppable
              class="absolute inset-0 pointer-events-none z-10"
            />
          );
        }}
      </Show>
      <Show when={showProjectOverlay()}>
        <FileDropOverlay>{dropActionText()}</FileDropOverlay>
      </Show>
    </>
  );
};
