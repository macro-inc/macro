import { fileFolderDrop } from '@core/directive/fileFolderDrop';
import { handleFileFolderDrop } from '@core/util/upload';
import { Telemetry } from '@macro-inc/observability';
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
      class="relative h-full flex flex-col mobile:px-0 mobile:pb-0"
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
      <div class="absolute pointer-events-none inset-0" use:droppable />
      {props.children}
    </div>
  );
}
