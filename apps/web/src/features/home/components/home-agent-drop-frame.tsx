import { FileDropOverlay } from '@core/component/FileDropOverlay';
import { fileFolderDrop } from '@core/directive/fileFolderDrop';
import { handleFileFolderDrop } from '@core/util/upload';
import { createSignal, type ParentProps, Show } from 'solid-js';

false && fileFolderDrop;

/**
 * Files dropped anywhere on Home's idle pane attach to the agent composer.
 * The legacy `DragDropWrapper` feeds the chat upload queue, which the agent
 * composer neither shows nor sends, so agents mode needs its own frame that
 * accepts the same files and folders as the composer's own drop zone.
 */
export function HomeAgentDropFrame(
  props: ParentProps<{
    class?: string;
    onDropFiles: (files: File[]) => void;
  }>
) {
  const [isFileDragging, setIsFileDragging] = createSignal(false);
  return (
    <div
      class={props.class}
      data-home-agent-drop-frame
      use:fileFolderDrop={{
        onDragStart: (valid) => setIsFileDragging(valid),
        onDragEnd: () => setIsFileDragging(false),
        onDrop: (files, folders) => {
          void handleFileFolderDrop(files, folders, (entries) =>
            props.onDropFiles(entries.map((entry) => entry.file))
          );
        },
      }}
    >
      {props.children}
      <Show when={isFileDragging()}>
        <FileDropOverlay>Drop files to attach to your message</FileDropOverlay>
      </Show>
    </div>
  );
}
