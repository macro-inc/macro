import type { EntityData } from '@entity';
import {
  createEntityDropZone,
  type EntityDropCoordinates,
} from './create-entity-drop-zone';

type CreateChannelDragStateOptions = {
  channelId: string;
};

export type ChannelDragState = {
  entityDropZone: ReturnType<typeof createEntityDropZone>;
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
