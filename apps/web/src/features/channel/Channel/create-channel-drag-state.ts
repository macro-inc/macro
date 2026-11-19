import type { EntityData } from '@entity';
import type {
  CreateEntityDropZoneOptions,
  EntityDropCoordinates,
} from './create-entity-drop-zone';

type ChannelEntityDropHandlers = Omit<
  CreateEntityDropZoneOptions,
  'droppableId'
>;

export type ChannelDragState = {
  /**
   * Handlers for the channel's entity drop zone. The zone itself is created by
   * the component that renders its element (`ChannelDropZone`): solid-dnd
   * registers a droppable when its creating owner mounts, so creating it here,
   * before the channel's content loads, would never register it.
   */
  entityDrop: ChannelEntityDropHandlers;
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

export function createChannelDragState(): ChannelDragState {
  let entityMentionInputHandlers: Parameters<
    ChannelDragState['setEntityMentionInputHandlers']
  >[0] = {};

  const entityDrop: ChannelEntityDropHandlers = {
    onDropEntity: (entity, coordinates) =>
      entityMentionInputHandlers.insertEntityMention?.(entity, coordinates),
    onDragEntityMove: (coordinates) =>
      entityMentionInputHandlers.previewEntityMentionInsertion?.(coordinates),
    onDragEntityEnd: () =>
      entityMentionInputHandlers.clearEntityMentionInsertionPreview?.(),
  };

  let attachFilesToChannel: ((files: File[]) => Promise<void>) | undefined;

  return {
    entityDrop,
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
