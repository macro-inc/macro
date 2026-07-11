import { useHandleFileUpload } from '@app/util/handleFileUpload';
import { useMaybeBlockId, useMaybeBlockName } from '@core/block';
import { fileSelector } from '@core/directive/fileSelector';
import { folderSelector } from '@core/directive/folderSelector';
import { isMobile } from '@core/mobile/isMobile';
import { handleFolderSelect } from '@core/util/upload';
import { createMemo, Show } from 'solid-js';

false && fileSelector;
false && folderSelector;

export function FolderDropZone() {
  const blockName = useMaybeBlockName();
  const blockId = useMaybeBlockId();
  const projectId = createMemo(() => {
    if (blockName === 'project' && blockId) {
      return blockId;
    }
    return undefined;
  });

  const handleFileUpload = useHandleFileUpload({ projectId: projectId() });

  return (
    <Show when={!isMobile()}>
      <div class="drop-zone flex w-full flex-col items-center justify-center rounded-md border border-dashed border-edge-muted bg-hover py-8">
        <p class="text-ink-muted">Drag & drop files and folders here</p>
        <p class="text-ink-muted">
          or{' '}
          <button
            type="button"
            use:fileSelector={{
              multiple: true,
              onSelect: (files) => {
                handleFileUpload(files);
              },
            }}
            class="cursor-pointer border-0 bg-transparent p-0 font-inherit text-inherit underline"
          >
            Upload files
          </button>{' '}
          /{' '}
          <button
            type="button"
            use:folderSelector={{
              onSelect: async (files) => {
                await handleFolderSelect(files, handleFileUpload);
              },
            }}
            class="cursor-pointer border-0 bg-transparent p-0 font-inherit text-inherit underline"
          >
            Upload folders
          </button>
        </p>
      </div>
    </Show>
  );
}
