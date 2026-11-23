import { MentionsMenuItem } from '@core/component/LexicalMarkdown/component/menu/MentionsMenu/components/MentionsMenuItem';
import { createMentionPageLoader } from '@core/component/LexicalMarkdown/component/menu/MentionsMenu/hooks/createMentionPageLoader';
import { useEntityMention } from '@core/component/LexicalMarkdown/component/menu/MentionsMenu/hooks/useEntityMention';
import type { MentionItem } from '@core/component/LexicalMarkdown/utils/mentionsUtils';
import { fileTypeToBlockName } from '@core/constant/allBlocks';
import { debouncedDependent } from '@core/util/debounce';
import { fireAndForget } from '@core/util/fireAndForget';
import SearchIcon from '@icon/system/regular/magnifying-glass.svg';
import {
  ctrlJKMenuNavigation,
  wrapIndex,
} from '@ui/utils/menuKeyboardNavigation';
import {
  createEffect,
  createMemo,
  createSignal,
  createUniqueId,
  type JSX,
  Show,
} from 'solid-js';
import { VList, type VListHandle } from 'virtua/solid';
import type { CanvasAsset } from '../../core/assets';
import { type CanvasInsertMode, canInsertAsset } from '../../core/insert';

false && ctrlJKMenuNavigation;

const ROW_HEIGHT = 36;
const TOUCH_ROW_HEIGHT = 44;

/**
 * Search the workspace for something to put on the canvas: images and videos,
 * or files to reference. `children` sits between the search field and the
 * results, for a view that offers another way in (uploading from the device).
 */
export function CanvasAssetPicker(props: {
  mode: CanvasInsertMode;
  onSelect: (asset: CanvasAsset) => void;
  onClose: () => void;
  /** Size the search field and the rows for fingers. */
  touch?: boolean;
  children?: JSX.Element;
}) {
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
          class="min-w-0 flex-1 bg-transparent outline-none placeholder:text-ink-placeholder"
          classList={{
            'h-7 text-sm': !props.touch,
            // 16px text keeps iOS from zooming the page into the field.
            'h-11 text-base': props.touch,
          }}
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
      {props.children}
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
            itemSize={props.touch ? TOUCH_ROW_HEIGHT : ROW_HEIGHT}
            class="overscroll-contain"
            style={{ height: '100%' }}
          >
            {(item, itemIndex) => (
              <div
                id={`${listId}-${itemIndex()}`}
                role="option"
                aria-selected={selected() === itemIndex()}
                // The row fills its slot on touch, so all of it takes a tap.
                classList={{ 'flex h-11 *:min-w-0 *:flex-1': props.touch }}
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
            classList={{ 'min-h-11': props.touch }}
            disabled={loading()}
            onClick={() => fireAndForget(source.loadMore(), 'canvas-assets')}
          >
            Load more
          </button>
        </Show>
      </div>
    </div>
  );
}
