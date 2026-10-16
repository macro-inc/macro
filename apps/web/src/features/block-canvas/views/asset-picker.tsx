import { MentionsMenuItem } from '@core/component/LexicalMarkdown/component/menu/MentionsMenu/components/MentionsMenuItem';
import { createMentionPageLoader } from '@core/component/LexicalMarkdown/component/menu/MentionsMenu/hooks/createMentionPageLoader';
import { useEntityMention } from '@core/component/LexicalMarkdown/component/menu/MentionsMenu/hooks/useEntityMention';
import type { MentionItem } from '@core/component/LexicalMarkdown/utils/mentionsUtils';
import { fileTypeToBlockName } from '@core/constant/allBlocks';
import { fileDrop } from '@core/directive/fileDrop';
import { debouncedDependent } from '@core/util/debounce';
import SearchIcon from '@phosphor/magnifying-glass.svg';
import UploadIcon from '@phosphor/upload-simple.svg';
import { Button } from '@ui/components/Button';
import {
  ctrlJKMenuNavigation,
  wrapIndex,
} from '@ui/utils/menuKeyboardNavigation';
import {
  createEffect,
  createMemo,
  createSignal,
  createUniqueId,
  Show,
} from 'solid-js';
import { VList, type VListHandle } from 'virtua/solid';
import type { CanvasAsset } from '../core/assets';
import { type CanvasInsertMode, canInsertAsset } from '../core/insert';

false && fileDrop;
false && ctrlJKMenuNavigation;

export function CanvasAssetPicker(props: {
  mode: CanvasInsertMode;
  onSelect: (asset: CanvasAsset) => void;
  onFiles: (files: File[]) => void;
  onClose: () => void;
}) {
  const [dragging, setDragging] = createSignal(false);
  let fileInput: HTMLInputElement | undefined;
  const [search, setSearch] = createSignal('');
  const [index, setIndex] = createSignal(0);
  const searchTerm = debouncedDependent(search, 60);
  const source = useEntityMention({
    buckets:
      props.mode === 'media'
        ? ['document']
        : ['document', 'note', 'task', 'snippet', 'skill'],
    searchTerm,
  });
  const items = createMemo(() =>
    source
      .entities()
      .filter(
        (item) =>
          item.data.type === 'document' &&
          item.data.fileType &&
          canInsertAsset(props.mode, fileTypeToBlockName(item.data.fileType))
      )
  );
  const selected = () => Math.min(index(), items().length - 1);
  const loading = () =>
    source.isLoading() || source.isLoadingMore() || search() !== searchTerm();
  const listId = createUniqueId();
  let list: VListHandle | undefined;
  createEffect(() => {
    const at = selected();
    if (at >= 0) list?.scrollToIndex(at, { align: 'nearest' });
  });
  const pick = (item: MentionItem) => {
    if (
      item.kind !== 'entity' ||
      item.data.type !== 'document' ||
      !item.data.fileType
    )
      return;
    props.onSelect({
      id: item.id,
      name: item.data.name,
      fileType: item.data.fileType,
    });
  };
  const loadPage = createMentionPageLoader();
  // Page the shared mention source past non-matching file types, and prefetch
  // near the selected row. The loader guards against an unchanged frontier.
  createEffect(() => {
    if (source.isLoading() || search() !== searchTerm()) return;
    const raw = source.entities();
    const needsPage = items().length < 8 || selected() >= items().length - 5;
    loadPage({
      bucket: {
        id: 'documents',
        hasMore: source.hasMore,
        isLoadingMore: source.isLoadingMore,
        loadMore: source.loadMore,
      },
      query: searchTerm(),
      itemCount: raw.length,
      selectedIndex: needsPage ? raw.length - 1 : -6,
    });
  });
  return (
    <div
      class="flex h-full min-h-0 flex-col"
      use:ctrlJKMenuNavigation={{ macOnly: false }}
      on:keydown={(event) => {
        if (event.key !== 'Tab') event.stopPropagation();
        if (event.key === 'Escape') {
          event.preventDefault();
          props.onClose();
        }
      }}
    >
      <div class="flex shrink-0 items-center gap-2 border-b border-edge-muted px-3 py-2">
        <SearchIcon class="size-4 shrink-0 text-ink-muted" />
        <input
          type="search"
          role="combobox"
          aria-label={`Search ${props.mode === 'media' ? 'media' : 'references'}`}
          aria-expanded="true"
          aria-autocomplete="list"
          aria-controls={listId}
          aria-activedescendant={
            selected() >= 0 ? `${listId}-${selected()}` : undefined
          }
          placeholder={
            props.mode === 'media' ? 'Find images or videos…' : 'Find a file…'
          }
          class="h-7 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-ink-placeholder"
          value={search()}
          onInput={(event) => {
            setIndex(0);
            setSearch(event.currentTarget.value);
          }}
          on:keydown={(event) => {
            if (event.isComposing) return;
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault();
              const length = items().length;
              if (length)
                setIndex(
                  wrapIndex(
                    selected(),
                    length,
                    event.key === 'ArrowDown' ? 1 : -1
                  )
                );
            } else if (event.key === 'Enter') {
              event.preventDefault();
              const item = items()[selected()];
              if (item && !loading()) pick(item);
            }
          }}
        />
      </div>
      <Show when={props.mode === 'media'}>
        <div
          aria-label="Upload canvas media"
          class="m-3 mb-1.5 flex min-h-44 shrink-0 flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-edge-muted p-4 text-center"
          classList={{ 'bg-hover': dragging() }}
          use:fileDrop={{
            multiple: true,
            onDrop: props.onFiles,
            onDragStart: setDragging,
            onDragEnd: () => setDragging(false),
          }}
        >
          <UploadIcon class="size-8 text-ink-extra-muted" />
          <div>
            <p class="text-sm text-ink">Drop files here</p>
            <p class="mt-1 text-xs text-ink-muted">
              Add images or videos to this canvas.
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => fileInput?.click()}
          >
            Add files
          </Button>
          <input
            ref={fileInput}
            type="file"
            multiple
            accept="image/*,video/*,.heic,.heif"
            aria-label="Choose canvas media"
            class="hidden"
            onChange={(event) => {
              const files = Array.from(event.currentTarget.files ?? []);
              if (files.length) props.onFiles(files);
              event.currentTarget.value = '';
            }}
          />
        </div>
      </Show>
      <div class="flex min-h-0 flex-1 flex-col py-1.5">
        <div
          id={listId}
          role="listbox"
          aria-label={`Available ${props.mode}`}
          class="min-h-0 flex-1 overflow-hidden"
          classList={{ hidden: !items().length }}
        >
          <VList
            ref={(handle) => {
              list = handle;
            }}
            data={items()}
            itemSize={36}
            class="overscroll-contain"
            style={{ height: '100%' }}
          >
            {(item, itemIndex) => (
              <div
                id={`${listId}-${itemIndex()}`}
                role="option"
                aria-selected={selected() === itemIndex()}
              >
                <MentionsMenuItem
                  item={item}
                  disableScrollIntoView
                  index={itemIndex()}
                  selected={selected() === itemIndex()}
                  setIndex={setIndex}
                  itemAction={pick}
                  setOpen={(open) => {
                    if (!open) props.onClose();
                  }}
                />
              </div>
            )}
          </VList>
        </div>
        <Show when={loading()}>
          <p role="status" class="px-3 py-2 text-xs text-ink-muted">
            Loading files…
          </p>
        </Show>
        <Show when={!items().length && !loading() && !source.hasMore()}>
          <p role="status" class="px-3 py-3 text-xs text-ink-muted">
            No matching files
          </p>
        </Show>
        <Show when={source.hasMore()}>
          <button
            type="button"
            class="w-full rounded px-3 py-2 text-xs text-ink-muted hover:bg-hover disabled:opacity-50"
            disabled={loading()}
            onClick={() => void source.loadMore()}
          >
            Load more
          </button>
        </Show>
      </div>
    </div>
  );
}
