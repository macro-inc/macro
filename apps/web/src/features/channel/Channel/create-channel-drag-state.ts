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
  /**
   * Makes `handlers` the composer that takes dropped entities as mentions.
   * The channel shows one composer at a time (its own input, or the unified
   * reply or edit input), and each registers when it mounts. Call the returned
   * release when that composer unmounts, so a drop never reaches a composer
   * that is gone; releasing a composer that was already replaced does nothing.
   */
  setEntityMentionInputHandlers: (
    handlers: EntityMentionInputHandlers
  ) => () => void;
};

type EntityMentionInputHandlers = {
  insertEntityMention?: (
    entity: EntityData,
    coordinates?: EntityDropCoordinates
  ) => void;
  previewEntityMentionInsertion?: (coordinates: EntityDropCoordinates) => void;
  clearEntityMentionInsertionPreview?: () => void;
};

export function createChannelDragState(): ChannelDragState {
  let entityMentionInputHandlers: EntityMentionInputHandlers = {};

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
      return () => {
        if (entityMentionInputHandlers === handlers) {
          entityMentionInputHandlers = {};
        }
      };
    },
  };
}
