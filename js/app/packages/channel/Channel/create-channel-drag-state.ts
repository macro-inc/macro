import type { EntityData } from '@entity';
import { type Accessor, createSignal } from 'solid-js';
import {
  createEntityDropZone,
  type EntityDropCoordinates,
} from './create-entity-drop-zone';

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
  setEntityMentionInputHandlers: (handlers: {
    insertEntityMention?: (
      entity: EntityData,
      coordinates?: EntityDropCoordinates
    ) => void;
    previewEntityMentionInsertion?: (
      coordinates: EntityDropCoordinates
    ) => void;
    clearEntityMentionInsertionPreview?: () => void;
  }) => void;
};

export function createChannelDragState(
  options: CreateChannelDragStateOptions
): ChannelDragState {
  const [isDraggingOverChannel, setIsDraggingOverChannel] = createSignal(false);
  const [isValidChannelDrag, setIsValidChannelDrag] = createSignal(true);

  let entityMentionInputHandlers: Parameters<
    ChannelDragState['setEntityMentionInputHandlers']
  >[0] = {};

  const entityDropZone = createEntityDropZone({
    droppableId: `channel-entity-drop-${options.channelId}`,
    onDropEntity: (entity, coordinates) =>
      entityMentionInputHandlers.insertEntityMention?.(entity, coordinates),
    onDragEntityMove: (coordinates) =>
      entityMentionInputHandlers.previewEntityMentionInsertion?.(coordinates),
    onDragEntityEnd: () =>
      entityMentionInputHandlers.clearEntityMentionInsertionPreview?.(),
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
    setEntityMentionInputHandlers: (handlers) => {
      entityMentionInputHandlers = handlers;
    },
  };
}
