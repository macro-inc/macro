import { fileFolderDrop } from '@core/directive/fileFolderDrop';
import { handleFileFolderDrop } from '@core/util/upload';
import { Telemetry } from '@macro-inc/observability';
import type { ParentProps } from 'solid-js';
import type { ChannelDragState } from './create-channel-drag-state';
import { createEntityDropZone } from './create-entity-drop-zone';

false && fileFolderDrop;

type ChannelDropZoneProps = ParentProps & {
  dragState: ChannelDragState;
};

export function ChannelDropZone(props: ChannelDropZoneProps) {
  // Created here, with the element it registers: solid-dnd adds a droppable
  // when the owner that created it mounts.
  const droppable = createEntityDropZone(props.dragState.entityDrop).droppable;
  false && droppable;

  // The droppable is the container itself: the pointer collision detector
  // walks up from the element under the pointer, so any hit inside the
  // channel resolves here unless a nearer droppable (a thread reply) wins.
  return (
    <div
      class="relative h-full flex flex-col mobile:px-0 mobile:pb-0"
      use:droppable
      use:fileFolderDrop={{
        onDrop: (files, folders) => {
          handleFileFolderDrop(files, folders, (entries) =>
            props.dragState.attachFilesToChannel?.(entries.map((e) => e.file))
          ).catch((error) =>
            Telemetry.error(error, { surface: 'channel-input' })
          );
        },
      }}
    >
      {props.children}
    </div>
  );
}
