import { FileDropOverlay } from '@core/component/FileDropOverlay';
import { fileFolderDrop } from '@core/directive/fileFolderDrop';
import { createSignal, type ParentProps, Show } from 'solid-js';

false && fileFolderDrop;

export function DriveFileDropzone(
  props: ParentProps<{
    onDrop: (
      files: FileSystemFileEntry[],
      folders: FileSystemDirectoryEntry[]
    ) => void;
  }>
) {
  const [dragging, setDragging] = createSignal(false);

  return (
    <div
      class="relative flex size-full min-h-0 flex-col"
      use:fileFolderDrop={{
        onDrop: props.onDrop,

        onDragStart: (valid) => setDragging(valid),

        onDragEnd: () => setDragging(false),
      }}
    >
      <Show when={dragging()}>
        <FileDropOverlay>
          Drop files here to add them to this location
        </FileDropOverlay>
      </Show>
      {props.children}
    </div>
  );
}
