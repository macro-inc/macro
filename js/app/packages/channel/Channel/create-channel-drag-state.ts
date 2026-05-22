import type { UploadFileInput } from '@core/util/uploadFile';
import { type Accessor, createSignal } from 'solid-js';
import type { InputAttachmentTracker } from '../Input';
import { createInputAttachmentTracker } from '../Input';
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
  attachFilesToChannel:
    | ((files: UploadFileInput[]) => Promise<void>)
    | undefined;
  setAttachFilesToChannel: (
    fn: (files: UploadFileInput[]) => Promise<void>
  ) => void;
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

  let attachFilesToChannel:
    | ((files: UploadFileInput[]) => Promise<void>)
    | undefined;

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
