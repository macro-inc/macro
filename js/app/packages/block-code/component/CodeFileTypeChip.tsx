import { useBlockId } from '@core/block';
import { blockMetadataSignal } from '@core/signal/load';
import { useCanEdit } from '@core/signal/permissions';
import { storageServiceClient } from '@service-storage/client';
import { Popover } from '@kobalte/core/popover';
import { createSignal, For, Show, createMemo } from 'solid-js';
import type { FileType } from '@service-storage/generated/schemas/fileType';
import { codeFileExtensions } from '../util/languageSupport';
import { createCallback } from '@solid-primitives/rootless';
import { setFileType } from '@core/component/FileList/itemOperations.ts';

const sortedExtensions = [...codeFileExtensions].sort();

export function CodeFileTypeChip() {
  const [blockMetadata, setBlockMetadata] = blockMetadataSignal;
  const fileType = () => blockMetadata()?.fileType;
  const canEdit = useCanEdit();
  const blockId = useBlockId();
  const [open, setOpen] = createSignal(false);
  const [search, setSearch] = createSignal('');

  const filteredExtensions = createMemo(() => {
    const query = search().toLowerCase();
    if (!query) return sortedExtensions;
    return sortedExtensions.filter((ext) => ext.includes(query));
  });

  let searchRef: HTMLInputElement | undefined;

  const handleSelect = createCallback(async (ext: string) => {
    setOpen(false);
    setSearch('');
    const metadata = blockMetadataSignal();
    if (!metadata || ext === fileType()) return;

    const success = setFileType({ id: blockId, fileType: ext as FileType });
    if (!success) return;

    setBlockMetadata({ ...metadata, fileType: ext });
  });

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
                      const exts = filteredExtensions();
                      if (exts.length > 0) {
                        handleSelect(exts[0]);
                      }
                    }
                  }}
                />
              </div>
              <div class="max-h-48 overflow-y-auto p-1">
                <For each={filteredExtensions()}>
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
                <Show when={filteredExtensions().length === 0}>
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
