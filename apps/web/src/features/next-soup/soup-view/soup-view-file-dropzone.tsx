import { useHandleFileUpload } from '@app/util/handleFileUpload';
import { FileDropOverlay } from '@core/component/FileDropOverlay';
import { fileFolderDrop } from '@core/directive/fileFolderDrop';
import { handleFileFolderDrop } from '@core/util/upload';
import { createSignal, type FlowComponent, Show } from 'solid-js';

false && fileFolderDrop;

export const SoupViewFileDropzone: FlowComponent = (props) => {
  const [isDragging, setIsDragging] = createSignal(false);
  const [isValidDrag, setIsValidDrag] = createSignal(true);

  const handleFileUpload = useHandleFileUpload();

  return (
    <div
      class="relative flex flex-col bg-panel size-full"
      use:fileFolderDrop={{
        onDrop: (fileEntries, folderEntries) => {
          handleFileFolderDrop(fileEntries, folderEntries, handleFileUpload);
        },
        onDragStart: () => {
          setIsValidDrag(true);
          setIsDragging(true);
        },
        onDragEnd: () => setIsDragging(false),
      }}
    >
      <Show when={isDragging()}>
        <FileDropOverlay valid={isValidDrag()}>
          <Show when={!isValidDrag()}>
            <div class="text-failure">[!] Invalid file type</div>
          </Show>
          <div>Drop any file here to add it to your workspace</div>
        </FileDropOverlay>
      </Show>
      {props.children}
    </div>
  );
};
