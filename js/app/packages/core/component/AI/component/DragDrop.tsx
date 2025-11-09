import { withAnalytics } from '@coparse/analytics';
import { FileDropOverlay } from '@core/component/FileDropOverlay';
import { fileDrop } from '@core/directive/fileDrop';

const { track, TrackingEvents } = withAnalytics();

import { SUPPORTED_ATTACHMENT_EXTENSIONS } from '@core/component/AI/constant';
import type { UploadQueue } from '@core/component/AI/types';
import type { Component, ParentProps } from 'solid-js';
import { createSignal, Show } from 'solid-js';

false && fileDrop; // Reference for SolidJS directive

type DragDropWrapperProps = ParentProps<{
  uploadQueue: UploadQueue;
  class?: string;
  overlayMessage?: string;
}>;

/**
 * A wrapper component that provides drag and drop file upload functionality
 * to its children. Shows a visual overlay when files are dragged over the area.
 */
export const DragDropWrapper: Component<DragDropWrapperProps> = (props) => {
  const [isDragging, setIsDragging] = createSignal(false);

  return (
    <div
      class={props.class}
      use:fileDrop={{
        acceptedFileExtensions: SUPPORTED_ATTACHMENT_EXTENSIONS,
        multiple: true,
        onDragStart: () => setIsDragging(true),
        onDragEnd: () => setIsDragging(false),
        onDrop: (files) => {
          track(TrackingEvents.CHAT.ATTACHMENT.DROP);
          props.uploadQueue.upload(files);
        },
      }}
    >
      {props.children}

      <Show when={isDragging()}>
        <FileDropOverlay>
          {props.overlayMessage || 'Drop files to attach to your message'}
        </FileDropOverlay>
      </Show>
    </div>
  );
};
