import clickOutside from '@core/directive/clickOutside';
import { useCanEdit } from '@core/signal/permissions';
import { createCallback } from '@solid-primitives/rootless';
import { debounce } from '@solid-primitives/scheduled';
import { Layer } from '@ui';
import {
  type Accessor,
  createEffect,
  createResource,
  createSignal,
  For,
  Show,
  untrack,
  useContext,
} from 'solid-js';
import {
  createMenuOpenSignal,
  MenuPriority,
} from '../../context/FloatingMenuContext';
import { LexicalWrapperContext } from '../../context/LexicalWrapperContext';
import { floatWithSelection } from '../../directive/floatWithSelection';
import {
  $insertGifNode,
  gifPickerPlugin,
  searchTenorGifs,
  type TenorGif,
} from '../../plugins/gif';
import { useMenuKeyboardNavigation } from './useMenuKeyboardNavigation';

false && floatWithSelection;
false && clickOutside;

const PICKER_WIDTH = 320;
const GRID_HEIGHT = 280;

export function FloatingGifMenu(props: { canEdit?: Accessor<boolean> } = {}) {
  const canEdit = props.canEdit ?? useCanEdit();
  const lexicalWrapper = useContext(LexicalWrapperContext);
  const plugins = () => lexicalWrapper?.plugins;
  const editor = () => lexicalWrapper?.editor;

  const [menuOpen, setMenuOpen] = createMenuOpenSignal(
    'gif-picker-menu',
    MenuPriority.Low,
    false
  );

  const [searchTerm, setSearchTerm] = createSignal('');
  const [debouncedSearchTerm, setDebouncedSearchTerm] = createSignal('');
  const [selectedIndex, setSelectedIndex] = createSignal(0);

  let inputRef: HTMLInputElement | undefined;

  const debouncedSetSearch = debounce(
    (term: string) => setDebouncedSearchTerm(term),
    300
  );

  createEffect(() => {
    debouncedSetSearch(searchTerm());
  });

  const [gifs] = createResource(debouncedSearchTerm, async (query) => {
    return searchTenorGifs(query, 30);
  });

  const resetMenu = () => {
    setMenuOpen(false);
    setSearchTerm('');
    setDebouncedSearchTerm('');
    setSelectedIndex(0);
  };

  const handleOpenPicker = createCallback(() => {
    if (menuOpen()) {
      resetMenu();
      return;
    }
    setTimeout(() => {
      setMenuOpen(true);
      setTimeout(() => inputRef?.focus(), 0);
    }, 0);
  });

  const insertGif = (gif: TenorGif) => {
    editor()?.update(() => {
      $insertGifNode(gif);
    });
    resetMenu();
    editor()?.focus();
  };

  createEffect(() => {
    const currentPlugins = plugins();
    if (!currentPlugins) return;

    currentPlugins.useReactive(canEdit, () => {
      if (!canEdit()) return;
      return gifPickerPlugin({ onOpenPicker: handleOpenPicker });
    });
  });

  const gifList = () => gifs() ?? [];

  useMenuKeyboardNavigation({
    isActive: menuOpen,
    onUp: () => {
      const cols = 2;
      setSelectedIndex((i) => Math.max(0, i - cols));
    },
    onDown: () => {
      const cols = 2;
      const maxIndex = gifList().length - 1;
      setSelectedIndex((i) => Math.min(maxIndex, i + cols));
    },
    onLeft: () => {
      setSelectedIndex((i) => Math.max(0, i - 1));
    },
    onRight: () => {
      const maxIndex = gifList().length - 1;
      setSelectedIndex((i) => Math.min(maxIndex, i + 1));
    },
    onSelect: () => {
      const gif = gifList()[selectedIndex()];
      if (gif) insertGif(gif);
    },
    onClose: () => {
      resetMenu();
      editor()?.focus();
    },
    onOtherKey: () => {},
  });

  createEffect(() => {
    if (selectedIndex() >= gifList().length && gifList().length > 0) {
      setSelectedIndex(gifList().length - 1);
    }
  });

  return (
    <Show when={menuOpen()}>
      <Layer depth={2}>
        <div
          class="fixed top-0 left-0 z-action-menu bg-surface rounded-xl shadow-lg ring-1 ring-edge cursor-default select-none overflow-hidden"
          style={{ width: `${PICKER_WIDTH}px` }}
          use:floatWithSelection={{
            selection: untrack(() => window.getSelection()),
            reactiveOnContainer: editor()?.getRootElement(),
          }}
          use:clickOutside={() => resetMenu()}
          on:mousedown={(e) => {
            if (e.target !== inputRef) {
              e.preventDefault();
            }
          }}
        >
          <div class="p-2 border-b border-edge">
            <input
              ref={inputRef}
              type="text"
              placeholder="Search GIFs..."
              value={searchTerm()}
              onInput={(e) => setSearchTerm(e.currentTarget.value)}
              class="w-full px-3 py-2 text-sm bg-ink/5 rounded-lg outline-none focus:ring-2 focus:ring-accent/50 placeholder:text-ink-muted"
            />
          </div>

          <div
            class="overflow-y-auto p-2 grid grid-cols-2 gap-2"
            style={{ height: `${GRID_HEIGHT}px` }}
          >
            <Show
              when={!gifs.loading}
              fallback={
                <div class="col-span-2 flex items-center justify-center h-32 text-ink-muted text-sm">
                  Loading...
                </div>
              }
            >
              <Show
                when={gifList().length > 0}
                fallback={
                  <div class="col-span-2 flex items-center justify-center h-32 text-ink-muted text-sm">
                    {searchTerm() ? 'No GIFs found' : 'Search for GIFs'}
                  </div>
                }
              >
                <For each={gifList()}>
                  {(gif, index) => (
                    <button
                      type="button"
                      onClick={() => insertGif(gif)}
                      onMouseOver={() => setSelectedIndex(index())}
                      class="relative rounded-lg overflow-hidden cursor-pointer transition-all"
                      classList={{
                        'ring-2 ring-accent': selectedIndex() === index(),
                        'hover:ring-2 hover:ring-accent/50':
                          selectedIndex() !== index(),
                      }}
                      style={{
                        'aspect-ratio': `${gif.width} / ${gif.height}`,
                        'max-height': '120px',
                      }}
                    >
                      <img
                        src={gif.previewUrl}
                        alt={gif.title}
                        loading="lazy"
                        class="w-full h-full object-cover"
                      />
                    </button>
                  )}
                </For>
              </Show>
            </Show>
          </div>

          <div class="px-3 py-1.5 border-t border-edge flex items-center justify-end">
            <span class="text-[10px] text-ink-extra-muted">
              Powered by Tenor
            </span>
          </div>
        </div>
      </Layer>
    </Show>
  );
}
