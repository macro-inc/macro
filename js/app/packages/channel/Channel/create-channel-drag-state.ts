import type { EntityData } from '@entity';
import { type Accessor, createSignal } from 'solid-js';
import { createEntityDropZone } from './create-entity-drop-zone';

type CreateChannelDragStateOptions = {
  channelId: string;
};

export type ChannelDragState = {
  entityDropZone: ReturnType<typeof createEntityDropZone>;
  isDraggingOverChannel: Accessor<boolean>;
  isValidChannelDrag: Accessor<boolean>;
  setIsDraggingOverChannel: (value: boolean) => void;
  setIsValidChannelDrag: (value: boolean) => void;
  attachFilesToChannel: ((files: File[]) => Promise<void>) | undefined;
  setAttachFilesToChannel: (fn: (files: File[]) => Promise<void>) => void;
  setInsertEntityMention: (fn: (entity: EntityData) => void) => void;
};

export function createChannelDragState(
  options: CreateChannelDragStateOptions
): ChannelDragState {
  const [isDraggingOverChannel, setIsDraggingOverChannel] = createSignal(false);
  const [isValidChannelDrag, setIsValidChannelDrag] = createSignal(true);

  let insertEntityMention: ((entity: EntityData) => void) | undefined;

  const entityDropZone = createEntityDropZone({
    droppableId: `channel-entity-drop-${options.channelId}`,
    onDropEntity: (entity) => insertEntityMention?.(entity),
  });

  let attachFilesToChannel: ((files: File[]) => Promise<void>) | undefined;

  return {
    entityDropZone,
    isDraggingOverChannel: () =>
      isDraggingOverChannel() || entityDropZone.isDraggingOver(),
    isValidChannelDrag,
    setIsDraggingOverChannel,
    setIsValidChannelDrag,
    get attachFilesToChannel() {
      return attachFilesToChannel;
    },
    setAttachFilesToChannel: (fn) => {
      attachFilesToChannel = fn;
    },
    setInsertEntityMention: (fn) => {
      insertEntityMention = fn;
    },
  };
}
