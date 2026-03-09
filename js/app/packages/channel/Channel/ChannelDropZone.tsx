import { fileFolderDrop } from '@core/directive/fileFolderDrop';
import { handleFileFolderDrop } from '@core/util/upload';
import type { ParentProps } from 'solid-js';
import type { ChannelDragState } from './create-channel-drag-state';

false && fileFolderDrop;

type ChannelDropZoneProps = ParentProps & {
  dragState: ChannelDragState;
};

export function ChannelDropZone(props: ChannelDropZoneProps) {
  const droppable = props.dragState.entityDropZone.droppable;
  false && droppable;

  return (
    <div
      class="relative h-full flex flex-col"
      use:fileFolderDrop={{
        onDragStart: (valid) => {
          props.dragState.setIsDraggingOverChannel(true);
          props.dragState.setIsValidChannelDrag(valid);
        },
        onDragEnd: () => props.dragState.setIsDraggingOverChannel(false),
        onDrop: (files, folders) => {
          handleFileFolderDrop(files, folders, (entries) => {
            void props.dragState.attachFilesToChannel?.(
              entries.map((e) => e.file)
            );
          });
        },
      }}
    >
      <div class="absolute pointer-events-none inset-0" use:droppable />
      {props.children}
    </div>
  );
}
