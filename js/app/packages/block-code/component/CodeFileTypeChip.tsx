import { useBlockId } from '@core/block';
import { blockMetadataSignal } from '@core/signal/load';
import { useCanEdit } from '@core/signal/permissions';
import { Popover } from '@kobalte/core/popover';
import { createSignal, For, Show, createMemo } from 'solid-js';
import { FileType } from '@service-storage/generated/schemas/fileType';
import { createUpdateFileTypeMutation } from '@macro-entity';

// NOTE: this attempts to match codemirror supported file types, see @block-code/util/languageSupport.ts
const DROPDOWN_FILE_TYPES: FileType[] = [
  FileType.c,
  FileType.cpp,
  FileType.css,
  FileType.csv,
  FileType.html,
  FileType.js,
  FileType.json,
  FileType.jsx,
  FileType.py,
  FileType.ts,
  FileType.tsx,
  FileType.txt,
  FileType.rs,
];

export function CodeFileTypeChip() {
  const [blockMetadata, setBlockMetadata] = blockMetadataSignal;
  const fileType = () => blockMetadata()?.fileType;
  const setFileType = (fileType: string | undefined) => {
    setBlockMetadata((prev) => {
      if (!prev) return prev;
      if (prev.fileType === fileType) return prev;
      return {
        ...prev,
        fileType,
      };
    });
  };
  const canEdit = useCanEdit();
  const blockId = useBlockId();
  const [open, setOpen] = createSignal(false);
  const [search, setSearch] = createSignal('');
  const updateFileType = createUpdateFileTypeMutation();

  const filteredFileTypes = createMemo(() => {
    const query = search().toLowerCase();
    if (!query) return DROPDOWN_FILE_TYPES;
    return DROPDOWN_FILE_TYPES.filter((ft) => ft.includes(query));
  });

  let searchRef: HTMLInputElement | undefined;

  const handleSelect = (ft: FileType) => {
    setOpen(false);
    setSearch('');
    const metadata = blockMetadata();
    const oldFileType = fileType() ?? undefined;
    if (!metadata || ft === oldFileType) return;

    setFileType(ft);
    updateFileType.mutate(
      {
        id: blockId,
        fileType: ft,
        oldFileType,
      },
      {
        onError: () => {
          setFileType(oldFileType);
        },
      }
    );
  };

  return (
    <Show when={fileType()}>
      <Show
        when={canEdit()}
        fallback={
          <span class="shrink-0 rounded px-1 py-0.5 text-[0.625rem] font-mono font-medium uppercase leading-none bg-code-bg text-code">
            {fileType()}
          </span>
        }
      >
        <Popover
          placement="bottom-start"
          open={open()}
          onOpenChange={(isOpen) => {
            setOpen(isOpen);
            if (!isOpen) setSearch('');
          }}
          gutter={4}
        >
          <Popover.Trigger class="shrink-0 rounded px-1 py-0.5 text-[0.625rem] font-mono font-medium uppercase leading-none bg-code-bg text-code hover:brightness-90 transition-[filter]">
            {fileType()}
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Content class="z-50 w-48 rounded shadow-md ring-1 ring-edge bg-dialog text-ink text-sm overflow-hidden">
              <div class="p-1.5 border-b border-edge">
                <input
                  ref={searchRef}
                  type="text"
                  placeholder="Search..."
                  class="w-full bg-transparent text-xs outline-none placeholder:text-ink-extra-muted"
                  value={search()}
                  onInput={(e) => setSearch(e.currentTarget.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      const exts = filteredFileTypes();
                      if (exts.length > 0) {
                        handleSelect(exts[0]);
                      }
                    }
                  }}
                />
              </div>
              <div class="max-h-48 overflow-y-auto p-1">
                <For each={filteredFileTypes()}>
                  {(ext) => (
                    <button
                      class="flex w-full items-center px-2 py-1 rounded text-xs font-mono uppercase hover:bg-hover transition-colors"
                      classList={{
                        'text-accent font-semibold': ext === fileType(),
                      }}
                      onClick={() => handleSelect(ext)}
                    >
                      {ext}
                    </button>
                  )}
                </For>
                <Show when={filteredFileTypes().length === 0}>
                  <div class="px-2 py-1 text-xs text-ink-muted">No results</div>
                </Show>
              </div>
            </Popover.Content>
          </Popover.Portal>
        </Popover>
      </Show>
    </Show>
  );
}
