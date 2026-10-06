import { fileTypeToBlockName } from '@core/constant/allBlocks';
import { useHistoryQuery } from '@queries/history/history';
import { createMemo, createSignal, Show } from 'solid-js';
import { VList } from 'virtua/solid';
import type { CanvasAsset } from '../core/assets';
import { canEmbedDocument } from '../core/document-display';

export function CanvasAssetPicker(props: {
  mode: 'media' | 'document' | 'embed';
  onSelect: (asset: CanvasAsset) => void;
  onFiles: (files: File[]) => void;
  onClose: () => void;
}) {
  const history = useHistoryQuery();
  const [search, setSearch] = createSignal('');
  const items = createMemo(() =>
    (history.isSuccess ? (history.data ?? []) : []).flatMap((item) => {
      if (item.type !== 'document' || !item.fileType) return [];
      if (props.mode === 'embed' && !canEmbedDocument(item.fileType)) return [];
      const kind = fileTypeToBlockName(item.fileType);
      if (props.mode === 'media' && kind !== 'image' && kind !== 'video')
        return [];
      if (!item.name.toLowerCase().includes(search().toLowerCase())) return [];
      return [{ id: item.id, name: item.name, fileType: item.fileType }];
    })
  );
  return (
    <section
      aria-label={props.mode === 'media' ? 'Insert media' : 'Insert document'}
      class="absolute right-4 top-4 z-30 flex max-h-[80%] w-80 flex-col gap-3 rounded-xl border border-edge-muted bg-panel p-3 shadow-lg"
      on:keydown={(event) => {
        event.stopPropagation();
        if (event.key === 'Escape') props.onClose();
      }}
    >
      <div class="flex items-center justify-between text-sm font-medium">
        {props.mode === 'media'
          ? 'Image or video'
          : props.mode === 'embed'
            ? 'Embed document or canvas'
            : 'Document preview'}
        <button
          type="button"
          aria-label="Close insert menu"
          class="rounded px-2 py-1 hover:bg-hover"
          onClick={props.onClose}
        >
          ×
        </button>
      </div>
      <Show when={props.mode === 'media'}>
        <label class="rounded border border-edge-muted p-2 text-xs">
          Upload image or video
          <input
            type="file"
            multiple
            accept="image/*,video/*,.heic,.heif"
            aria-label="Upload canvas media"
            class="mt-2 block w-full text-xs"
            onChange={(event) => {
              props.onFiles(Array.from(event.currentTarget.files ?? []));
              event.currentTarget.value = '';
            }}
          />
        </label>
      </Show>
      <input
        type="search"
        aria-label="Search workspace files"
        placeholder="Search your files…"
        class="rounded border border-edge-muted bg-input px-3 py-2 text-sm"
        value={search()}
        onInput={(event) => setSearch(event.currentTarget.value)}
      />
      <div class="min-h-0 overflow-y-auto">
        <Show
          when={!history.isPending}
          fallback={<p class="p-2 text-xs text-ink-muted">Loading files…</p>}
        >
          <Show
            when={items().length}
            fallback={
              <p class="p-2 text-xs text-ink-muted">
                {history.isError ? 'Could not load files' : 'No matching files'}
              </p>
            }
          >
            <VList data={items()} style={{ height: '320px' }}>
              {(item) => (
                <button
                  type="button"
                  class="flex w-full items-center gap-2 rounded p-2 text-left text-xs hover:bg-hover"
                  onClick={() => props.onSelect(item)}
                >
                  <span class="min-w-0 flex-1 truncate">{item.name}</span>
                  <span class="text-ink-muted">{item.fileType}</span>
                </button>
              )}
            </VList>
          </Show>
        </Show>
      </div>
    </section>
  );
}
