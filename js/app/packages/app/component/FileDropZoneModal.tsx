import { FileDropZone } from '@core/component/FileDropZone';
import { Overlay } from '@core/component/Modal';
import {
  blockAcceptedFileExtensions,
  blockAcceptedMimeTypes,
} from '@core/constant/allBlocks';
import { uploadFiles } from '@core/util/upload';
import Dialog from '@corvu/dialog';
import { useUserId } from '@service-gql/client';
import { Show } from 'solid-js';

export const FILE_DROP_ZONE_DIALOG_CONTEXT_NAME = 'file-drop-zone-modal';

export function FileDropZoneModal() {
  const userId = useUserId();

  const dialogContext = Dialog.useContext(FILE_DROP_ZONE_DIALOG_CONTEXT_NAME);

  return (
    <Show when={userId()}>
      <Dialog.Portal contextId={FILE_DROP_ZONE_DIALOG_CONTEXT_NAME}>
        <Overlay contextId={FILE_DROP_ZONE_DIALOG_CONTEXT_NAME} />
        <Dialog.Content
          class="bg-dialog rounded-xl p-1 w-[250px] h-[257px] md:w-[433px] fixed left-1/2 top-1/2 z-modal -translate-x-1/2 -translate-y-1/2"
          contextId={FILE_DROP_ZONE_DIALOG_CONTEXT_NAME}
        >
          <FileDropZone
            class="w-full h-full rounded-lg overflow-hidden border border-edge border-dashed inline-flex flex-col justify-center items-center gap-[14px]"
            acceptedMimeTypes={blockAcceptedMimeTypes}
            acceptedExtensions={blockAcceptedFileExtensions}
            onFilesDrop={async (files) => {
              await uploadFiles(files, 'dss');
              dialogContext.setOpen(false);
            }}
          >
            <div class="w-[222px] text-center text-ink-muted text-sm font-sans font-normal leading-[20px] break-words select-none cursor-default">
              Drag and drop or{' '}
              <span class="text-accent-ink underline">click</span> to import.
            </div>
          </FileDropZone>
        </Dialog.Content>
      </Dialog.Portal>
    </Show>
  );
}
