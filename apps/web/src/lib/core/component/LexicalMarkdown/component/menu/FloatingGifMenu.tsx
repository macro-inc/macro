import { type PortalScope, ScopedPortal } from '@core/component/ScopedPortal';
import clickOutside from '@core/directive/clickOutside';
import { useCanEdit } from '@core/signal/permissions';
import MagnifyingGlassIcon from '@phosphor/magnifying-glass.svg';
import { createCallback } from '@solid-primitives/rootless';
import { debounce } from '@solid-primitives/scheduled';
import { cn, InputGroup, Surface } from '@ui';
import { $getSelection, $setSelection, type BaseSelection } from 'lexical';
import {
  type Accessor,
  createEffect,
  createResource,
  createSignal,
  For,
  Match,
  Show,
  Switch,
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
  type Gif,
  gifPickerPlugin,
  searchGifs,
} from '../../plugins/gif';
import PoweredByKlipy from '../../plugins/gif/powered-by-klipy.svg';
import { useMenuKeyboardNavigation } from './useMenuKeyboardNavigation';

false && floatWithSelection;
false && clickOutside;

const COLUMNS = 2;
const RESULT_LIMIT = 30;

/**
 * GIF search, opened via TRY_INSERT_GIF_COMMAND (`/gif` or a composer's +).
 * The search field takes focus; arrows move through the grid, Enter inserts,
 * Escape closes. Portalled like the slash menu so the editor shell's click
 * and keydown handlers don't swallow the picker's events.
 */
export function FloatingGifMenu(
  props: { canEdit?: Accessor<boolean>; portalScope?: PortalScope } = {}
) {
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
  // The search field takes focus, so the editor's caret is kept to insert at.
  let insertAt: BaseSelection | null = null;
  let inputRef: HTMLInputElement | undefined;

  const debouncedSetSearch = debounce(setDebouncedSearchTerm, 300);
  const updateSearch = (term: string) => {
    setSearchTerm(term);
    setSelectedIndex(0);
    debouncedSetSearch(term);
  };

  const [gifs, { refetch }] = createResource(
    () => (menuOpen() ? debouncedSearchTerm() : false),
    (query) => searchGifs(query, RESULT_LIMIT)
  );
  const gifList = () => (gifs.state === 'ready' ? gifs() : []);

  const resetMenu = () => {
    setMenuOpen(false);
    debouncedSetSearch.clear();
    setSearchTerm('');
    setDebouncedSearchTerm('');
    setSelectedIndex(0);
    insertAt = null;
  };

  const closeToEditor = () => {
    resetMenu();
    editor()?.focus();
  };

  const handleOpenPicker = createCallback(() => {
    if (!canEdit() || !editor()?.isEditable()) return;
    if (menuOpen()) {
      resetMenu();
      return;
    }
    insertAt = $getSelection()?.clone() ?? null;
    // Defer past the keystroke that ran the command, as FloatingTableMenu does.
    setTimeout(() => {
      if (!canEdit() || !editor()?.isEditable()) return;
      setMenuOpen(true);
      inputRef?.focus();
    }, 0);
  });

  const insertGif = (gif: Gif) => {
    const currentEditor = editor();
    if (!canEdit() || !currentEditor?.isEditable()) {
      resetMenu();
      return;
    }
    const selection = insertAt;
    currentEditor.update(() => {
      if (!canEdit() || !currentEditor.isEditable()) return;
      if (selection) $setSelection(selection.clone());
      $insertGifNode(gif);
    });
    closeToEditor();
  };

  createEffect(() => {
    if (!canEdit()) resetMenu();
  });

  createEffect(() => {
    const currentPlugins = plugins();
    if (!currentPlugins) return;

    currentPlugins.useReactive(canEdit, () => {
      if (!canEdit()) return;
      return gifPickerPlugin({ onOpenPicker: handleOpenPicker });
    });
  });

  const moveSelection = (delta: number) => {
    const lastIndex = gifList().length - 1;
    if (lastIndex < 0) return;
    setSelectedIndex((index) =>
      Math.min(lastIndex, Math.max(0, index + delta))
    );
  };

  useMenuKeyboardNavigation({
    isActive: menuOpen,
    onUp: () => moveSelection(-COLUMNS),
    onDown: () => moveSelection(COLUMNS),
    onLeft: () => moveSelection(-1),
    onRight: () => moveSelection(1),
    onSelect: () => {
      const gif = gifList()[selectedIndex()];
      if (gif) insertGif(gif);
    },
    onClose: closeToEditor,
  });

  return (
    <Show when={menuOpen()}>
      <ScopedPortal scope={props.portalScope}>
        <div
          data-holds-prompts
          class="w-80 cursor-default select-none z-modal-content menu-open-animation"
          use:floatWithSelection={{
            selection: untrack(() => window.getSelection()),
            reactiveOnContainer: editor()?.getRootElement(),
          }}
          use:clickOutside={resetMenu}
          on:touchstart={(event) => event.stopPropagation()}
          // Keep focus in the search field while picking a GIF.
          on:mousedown={(event) => {
            if (event.target !== inputRef) event.preventDefault();
          }}
        >
          <Surface depth={2} class="menu-surface flex flex-col gap-1.5 p-1.5">
            <InputGroup size="sm">
              <InputGroup.Input
                ref={inputRef}
                type="search"
                value={searchTerm()}
                onInput={(event) => updateSearch(event.currentTarget.value)}
                placeholder="Search KLIPY"
                aria-label="Search GIFs"
              />
              <InputGroup.Addon align="inline-start">
                <MagnifyingGlassIcon aria-hidden="true" />
              </InputGroup.Addon>
            </InputGroup>

            <div class="h-70 overflow-y-auto overscroll-contain scrollbar-hidden">
              <Switch>
                <Match when={gifs.error}>
                  <div class="flex h-full flex-col items-center justify-center gap-1 text-sm text-ink-muted">
                    Couldn't load GIFs
                    <button
                      type="button"
                      class="text-xs text-accent"
                      onClick={() => refetch()}
                    >
                      Try again
                    </button>
                  </div>
                </Match>
                <Match when={gifs.loading && gifList().length === 0}>
                  <div class="flex h-full items-center justify-center text-sm text-ink-muted">
                    Loading…
                  </div>
                </Match>
                <Match when={gifList().length === 0}>
                  <div class="flex h-full items-center justify-center text-sm text-ink-muted">
                    No GIFs found
                  </div>
                </Match>
                <Match when={true}>
                  <div class="grid grid-cols-2 auto-rows-24 gap-1.5 p-0.5">
                    <For each={gifList()}>
                      {(gif, index) => (
                        <button
                          type="button"
                          aria-label={gif.title}
                          onClick={() => insertGif(gif)}
                          onPointerEnter={() => setSelectedIndex(index())}
                          class={cn(
                            'size-full overflow-hidden rounded-lg bg-ink/5 outline-none',
                            selectedIndex() === index() && 'ring-2 ring-accent'
                          )}
                        >
                          <img
                            src={gif.previewUrl}
                            alt=""
                            loading="lazy"
                            class="size-full object-cover"
                          />
                        </button>
                      )}
                    </For>
                  </div>
                </Match>
              </Switch>
            </div>

            <div class="flex justify-end px-1">
              <PoweredByKlipy
                class="h-2.5 w-auto text-ink-extra-muted"
                aria-label="Powered by KLIPY"
              />
            </div>
          </Surface>
        </div>
      </ScopedPortal>
    </Show>
  );
}
