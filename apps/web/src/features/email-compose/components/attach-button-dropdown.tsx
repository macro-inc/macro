import {
  getFileDocumentBlob,
  loadFileDocumentData,
} from '@app/features/drive-view/queries/file-document';
import { documentDownloadName } from '@app/features/drive-view/util/document-download-name';
import type { DraftFormAttachment } from '@app/features/email-compose/primitives/email-form-state';
import { EntityIcon } from '@core/component/EntityIcon';
import { useQuickAccess } from '@core/context/quickAccess';
import type { QuickAccessEntity } from '@core/context/quickAccess/types';
import { fileSelector } from '@core/directive/fileSelector';
import FolderOpen from '@phosphor/folder-open.svg';
import MagnifyingGlass from '@phosphor/magnifying-glass.svg';
import PaperclipIcon from '@phosphor/paperclip.svg';
import UploadSimple from '@phosphor/upload-simple.svg';
import { Dialog, Dropdown, Input, InputGroup } from '@ui';
import { createSignal, For, Show } from 'solid-js';

false && fileSelector;

const ATTACHABLE_FILE_TYPES = new Set([
  'pdf',
  'image',
  'video',
  'audio',
  'unknown',
  'code',
  'spreadsheet',
  'file',
]);

interface AttachButtonDropdownProps {
  onAddAttachments: (attachments: DraftFormAttachment[]) => void;
  onFailure: (message: string, options?: { subtext?: string }) => void;
  disabled?: boolean;
}

export function AttachButtonDropdown(props: AttachButtonDropdownProps) {
  const [drivePickerOpen, setDrivePickerOpen] = createSignal(false);

  let fileInputRef: HTMLInputElement | undefined;

  const handleUploadFromComputer = () => {
    fileInputRef?.click();
  };

  const handleFileSelect = (files: File[]) => {
    if (files.length === 0) return;
    props.onAddAttachments(files.map((file) => ({ type: 'local', file })));
  };

  const handleBrowseDrive = () => {
    setDrivePickerOpen(true);
  };

  const handleDocumentSelect = async (documentId: string) => {
    setDrivePickerOpen(false);
    try {
      const documentData = await loadFileDocumentData(documentId);
      const metadata = documentData.documentMetadata;

      const blob = await getFileDocumentBlob({
        documentId,
        documentVersionId: metadata.documentVersionId,
      });

      const fileName = documentDownloadName(metadata);
      const file = new File([blob], fileName, { type: blob.type });

      props.onAddAttachments([{ type: 'local', file }]);
    } catch (error) {
      console.error('Failed to attach document:', error);
      props.onFailure('Failed to attach document');
    }
  };

  return (
    <>
      <Dropdown>
        <Dropdown.Trigger
          tooltip="Attach"
          size="icon-composer"
          disabled={props.disabled}
        >
          <PaperclipIcon />
        </Dropdown.Trigger>
        <Dropdown.Content>
          <Dropdown.Group>
            <Dropdown.Item onSelect={handleUploadFromComputer}>
              <UploadSimple class="size-4" />
              Upload from computer
            </Dropdown.Item>
            <Dropdown.Item onSelect={handleBrowseDrive}>
              <FolderOpen class="size-4" />
              Choose from drive
            </Dropdown.Item>
          </Dropdown.Group>
        </Dropdown.Content>
      </Dropdown>
      <input
        ref={(el) => {
          fileInputRef = el;
        }}
        type="file"
        multiple
        class="hidden"
        onChange={(e) => {
          const files = Array.from(e.currentTarget.files ?? []);
          handleFileSelect(files);
          e.currentTarget.value = '';
        }}
      />
      <Show when={drivePickerOpen()}>
        <DriveDocumentPicker
          onClose={() => setDrivePickerOpen(false)}
          onSelect={handleDocumentSelect}
        />
      </Show>
    </>
  );
}

interface DriveDocumentPickerProps {
  onClose: () => void;
  onSelect: (documentId: string) => void;
}

function DriveDocumentPicker(props: DriveDocumentPickerProps) {
  const [query, setQuery] = createSignal('');
  const [open, setOpen] = createSignal(true);
  const { useList } = useQuickAccess();
  const items = useList('document');

  const handleOpenChange = (isOpen: boolean) => {
    setOpen(isOpen);
    if (!isOpen) {
      props.onClose();
    }
  };

  const filteredItems = () => {
    const q = query().toLowerCase().trim();
    const all = items();
    const attachable = all.filter((item) => {
      if (item.bucket !== 'document') return false;
      const entity = item as QuickAccessEntity;
      const fileType =
        entity.data?.type === 'document' ? entity.data.fileType : null;
      return fileType && ATTACHABLE_FILE_TYPES.has(fileType);
    }) as QuickAccessEntity[];

    if (!q) return attachable.slice(0, 20);

    return attachable
      .filter((item) => item.searchText.toLowerCase().includes(q))
      .slice(0, 20);
  };

  return (
    <Dialog open={open()} onOpenChange={handleOpenChange}>
      <Dialog.Panel class="sm:max-w-md">
        <Dialog.Header>
          <Dialog.Title>Choose from drive</Dialog.Title>
          <Dialog.Description>
            Select a file from your drive to attach to this email.
          </Dialog.Description>
        </Dialog.Header>
        <Dialog.Body class="p-4 flex flex-col gap-3">
          <InputGroup>
            <InputGroup.Addon align="left">
              <MagnifyingGlass class="size-4 text-ink-muted" />
            </InputGroup.Addon>
            <Input
              placeholder="Search files..."
              value={query()}
              onInput={(e) => setQuery(e.currentTarget.value)}
              autofocus
            />
          </InputGroup>
          <div class="max-h-64 overflow-y-auto">
            <Show
              when={filteredItems().length > 0}
              fallback={
                <div class="text-center py-4 text-ink-muted">
                  No files found
                </div>
              }
            >
              <For each={filteredItems()}>
                {(item) => (
                  <button
                    type="button"
                    class="w-full flex items-center gap-2 px-2 py-2 rounded-md hover:bg-hover text-left"
                    onClick={() => props.onSelect(item.id)}
                  >
                    <EntityIcon
                      targetType={
                        item.data?.type === 'document'
                          ? item.data.fileType
                          : 'unknown'
                      }
                      size="sm"
                    />
                    <span class="truncate flex-1">{item.searchText}</span>
                  </button>
                )}
              </For>
            </Show>
          </div>
        </Dialog.Body>
      </Dialog.Panel>
    </Dialog>
  );
}
