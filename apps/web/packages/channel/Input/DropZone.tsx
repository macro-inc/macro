import { fileFolderDrop } from '@core/directive/fileFolderDrop';
import { handleFileFolderDrop } from '@core/util/upload';
import type { ParentProps } from 'solid-js';
import { useInputCommands } from './context';

false && fileFolderDrop;

type DropZoneProps = ParentProps & {
  onDragStart?: (valid: boolean) => void;
  onDragEnd?: () => void;
};

export function DropZone(props: DropZoneProps) {
  const commands = useInputCommands();

  return (
    <div
      class="contents"
      use:fileFolderDrop={{
        onDragStart: (valid) => props.onDragStart?.(valid),
        onDragEnd: () => props.onDragEnd?.(),
        onDrop: (files, folders) => {
          handleFileFolderDrop(files, folders, (entries) => {
            void commands.attachFiles(entries.map((e) => e.file));
          });
        },
      }}
    >
      {props.children}
    </div>
  );
}
