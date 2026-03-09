import { createSignal, type Accessor } from 'solid-js';
import { createInputAttachmentTracker } from '../Input';
import type { InputAttachmentTracker } from '../Input';
import { createEntityDropZone } from './create-entity-drop-zone';

type CreateChannelDragStateOptions = {
  channelId: string;
  attachmentTracker: InputAttachmentTracker;
};

export type ChannelDragState = {
  entityDropZone: ReturnType<typeof createEntityDropZone>;
  isDraggingOverChannel: Accessor<boolean>;
  isValidChannelDrag: Accessor<boolean>;
  setIsDraggingOverChannel: (value: boolean) => void;
  setIsValidChannelDrag: (value: boolean) => void;
  attachFilesToChannel: ((files: File[]) => Promise<void>) | undefined;
  setAttachFilesToChannel: (fn: (files: File[]) => Promise<void>) => void;
};

export function createChannelDragState(
  options: CreateChannelDragStateOptions
): ChannelDragState {
  const tracker = createInputAttachmentTracker();
  const [isDraggingOverChannel, setIsDraggingOverChannel] = createSignal(false);
  const [isValidChannelDrag, setIsValidChannelDrag] = createSignal(true);

  const entityDropZone = createEntityDropZone({
    droppableId: `channel-entity-drop-${options.channelId}`,
    tracker,
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
  };
}
