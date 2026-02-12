import { withAnalytics } from '@coparse/analytics';
import { FileDropOverlay } from '@core/component/FileDropOverlay';
import { fileDrop } from '@core/directive/fileDrop';

const { track, TrackingEvents } = withAnalytics();

import { SUPPORTED_ATTACHMENT_EXTENSIONS } from '@core/component/AI/constant';
import { useChatInputContext } from '@core/component/AI/context';
import type { Accessor, Component, ParentProps } from 'solid-js';
import { createSignal, Show } from 'solid-js';

false && fileDrop; // Reference for SolidJS directive

type DragDropWrapperProps = ParentProps<{
  class?: string;
  overlayMessage?: string;
  /** Signal indicating if an entity is being dragged over (from useEntityDropAttachment) */
  isEntityDraggingOver?: Accessor<boolean>;
}>;

/**
 * A wrapper component that provides drag and drop file upload functionality
 * to its children. Shows a visual overlay when files are dragged over the area.
 */
export const DragDropWrapper: Component<DragDropWrapperProps> = (props) => {
  const input = useChatInputContext();
  const uploadQueue = input.uploadQueue;

  const [isFileDragging, setIsFileDragging] = createSignal(false);

  const showOverlay = () => isFileDragging() || props.isEntityDraggingOver?.();

  return (
    <div
      class={props.class}
      use:fileDrop={{
        acceptedFileExtensions: SUPPORTED_ATTACHMENT_EXTENSIONS,
        multiple: true,
        onDragStart: () => setIsFileDragging(true),
        onDragEnd: () => setIsFileDragging(false),
        onDrop: (files) => {
          track(TrackingEvents.CHAT.ATTACHMENT.DROP);
          uploadQueue.upload(files);
        },
      }}
    >
      {props.children}

      <Show when={showOverlay()}>
        <FileDropOverlay>
          {props.overlayMessage || 'Drop files to attach to your message'}
        </FileDropOverlay>
      </Show>
    </div>
  );
};
