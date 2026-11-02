import { type PortalScope, ScopedPortal } from '@core/component/ScopedPortal';
import clickOutside from '@core/directive/clickOutside';
import { useCanEdit } from '@core/signal/permissions';
import { fireAndForget } from '@core/util/fireAndForget';
import { discardStaticUpload } from '@core/util/uploadFile';
import { useIsKeyPressActive } from '@core/util/useIsKeyPressActive';
import MagnifyingGlassIcon from '@icon/system/regular/magnifying-glass.svg';
import { createCallback } from '@solid-primitives/rootless';
import { debounce } from '@solid-primitives/scheduled';
import { cn, InputGroup, Surface } from '@ui';
import {
  $addUpdateTag,
  $getNodeByKey,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  $setSelection,
  type BaseSelection,
  SKIP_DOM_SELECTION_TAG,
} from 'lexical';
import {
  type Accessor,
  createEffect,
  createResource,
  createSignal,
  For,
  Match,
  onCleanup,
  onMount,
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
import { uploadGif } from '../../plugins/gif/uploadGif';
import { registerRootEventListener } from '../../plugins/shared/utils';
import { useMenuKeyboardNavigation } from './useMenuKeyboardNavigation';

false && floatWithSelection;
false && clickOutside;

const COLUMNS = 2;
const RESULT_LIMIT = 30;
// Search field, padding, and "Powered by" row around the grid.
const PANEL_CHROME_HEIGHT = 100;
const MAX_GRID_HEIGHT = 360;

/**
 * GIF search, opened via TRY_INSERT_GIF_COMMAND (`/gif` or a composer's +).
 * Focuses search on open while keeping the insertion caret in the editor.
 * Arrows move through the grid, Enter inserts, Escape closes. Portalled like
 * the slash menu, with an event boundary so composer handlers cannot steal
 * focus from search.
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
  const [uploading, setUploading] = createSignal(false);
  const [uploadError, setUploadError] = createSignal(false);
  let uploadController: AbortController | undefined;
  const [menuAvailableHeight, setMenuAvailableHeight] = createSignal<
    number | undefined
  >(undefined);

  const gridMaxHeight = () => {
    const available = menuAvailableHeight();
    if (available === undefined) return MAX_GRID_HEIGHT;
    return Math.min(
      MAX_GRID_HEIGHT,
      Math.max(0, available - PANEL_CHROME_HEIGHT)
    );
  };
  // The search field takes focus, so the editor's caret is kept to insert at.
  let insertAt: BaseSelection | null = null;
  let inputRef: HTMLInputElement | undefined;
  let gridRef: HTMLDivElement | undefined;

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

  const cancelUpload = () => {
    uploadController?.abort();
    uploadController = undefined;
    setUploading(false);
  };

  const resetMenu = () => {
    cancelUpload();
    setUploadError(false);
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
    // Keep Lexical's commit from reclaiming focus after the command returns.
    $addUpdateTag(SKIP_DOM_SELECTION_TAG);
    setMenuOpen(true);
  });

  const insertGif = async (gif: Gif) => {
    if (uploading()) return;
    const currentEditor = editor();
    if (!canEdit() || !currentEditor?.isEditable()) {
      resetMenu();
      return;
    }
    const selection = insertAt?.clone();
    const root = currentEditor.getRootElement();
    const request = new AbortController();
    uploadController = request;
    setUploading(true);
    let uploadedId: string | undefined;
    let inserted = false;
    setUploadError(false);
    const unregisterUpdate = currentEditor.registerUpdateListener(
      ({ dirtyElements, dirtyLeaves }) => {
        if (dirtyElements.size || dirtyLeaves.size) resetMenu();
      }
    );
    request.signal.addEventListener('abort', unregisterUpdate, { once: true });
    try {
      const result = await uploadGif(gif, request.signal);
      if (result.isErr()) {
        if (!request.signal.aborted && result.error.kind === 'failed') {
          setUploadError(true);
        }
        return;
      }
      uploadedId = result.value;
      if (
        request.signal.aborted ||
        !menuOpen() ||
        !canEdit() ||
        !currentEditor.isEditable() ||
        currentEditor !== editor() ||
        root !== currentEditor.getRootElement()
      )
        return;

      currentEditor.update(
        () => {
          // A cleared draft must not receive the old request's image.
          if (
            selection &&
            $isRangeSelection(selection) &&
            (!$getNodeByKey(selection.anchor.key)?.isAttached() ||
              !$getNodeByKey(selection.focus.key)?.isAttached())
          )
            return;
          if (selection) $setSelection(selection);
          else if (!$getSelection()) $getRoot().selectEnd();
          $insertGifNode(gif, result.value);
          inserted = true;
        },
        { discrete: true }
      );
      closeToEditor();
    } finally {
      request.signal.removeEventListener('abort', unregisterUpdate);
      unregisterUpdate();
      if (uploadController === request) {
        uploadController = undefined;
        setUploading(false);
      }
      if (uploadedId && !inserted) await discardStaticUpload(uploadedId);
    }
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

  const { isKeypressActive } = useIsKeyPressActive();
  const selectFromPointer = (index: number) => {
    if (!isKeypressActive()) setSelectedIndex(index);
  };

  const moveSelection = (delta: number) => {
    const lastIndex = gifList().length - 1;
    if (lastIndex < 0) return;
    const nextIndex = Math.min(lastIndex, Math.max(0, selectedIndex() + delta));
    setSelectedIndex(nextIndex);
    gridRef?.children[nextIndex]?.scrollIntoView({ block: 'nearest' });
  };

  useMenuKeyboardNavigation({
    isActive: menuOpen,
    onUp: () => moveSelection(-COLUMNS),
    onDown: () => moveSelection(COLUMNS),
    onLeft: () => moveSelection(-1),
    onRight: () => moveSelection(1),
    onSelect: () => {
      const gif = gifList()[selectedIndex()];
      if (gif) fireAndForget(insertGif(gif), 'gif-picker');
    },
    onClose: closeToEditor,
  });

  return (
    <Show when={menuOpen()}>
      <ScopedPortal scope={props.portalScope}>
        <div
          ref={(panel) => {
            const currentEditor = editor();
            if (!currentEditor) return;
            onCleanup(cancelUpload);
            // Search belongs to this composer even though its DOM is portalled.
            onCleanup(
              registerRootEventListener(currentEditor, 'focusout', (event) => {
                if (
                  event.relatedTarget instanceof Node &&
                  panel.contains(event.relatedTarget)
                ) {
                  event.stopPropagation();
                }
              })
            );
          }}
          data-holds-prompts
          data-keep-keyboard
          class="w-[28rem] mobile:w-[calc(100cqw-1rem-2px)] max-w-[calc(100cqw-1rem-2px)] cursor-default select-none z-modal-content menu-open-animation"
          use:floatWithSelection={{
            selection: untrack(() => window.getSelection()),
            reactiveOnContainer: editor()?.getRootElement(),
            onAvailableHeight: setMenuAvailableHeight,
            fullHeight: MAX_GRID_HEIGHT + PANEL_CHROME_HEIGHT,
          }}
          use:clickOutside={resetMenu}
          on:touchstart={(event) => event.stopPropagation()}
          // Keep composer/search focus while picking a GIF. Cancel both
          // pointerdown and mousedown; iOS still emits the latter.
          on:pointerdown={(event) => {
            if (event.target !== inputRef) event.preventDefault();
            event.stopPropagation();
          }}
          on:mousedown={(event) => {
            if (event.target !== inputRef) event.preventDefault();
            event.stopPropagation();
          }}
          onClick={(event) => event.stopPropagation()}
        >
          <Surface
            depth={2}
            hideBorder
            class="menu-surface rounded-xl flex flex-col gap-1.5 p-1.5"
          >
            <InputGroup size="xl" onClick={() => inputRef?.focus()}>
              <InputGroup.Input
                ref={(element) => {
                  inputRef = element;
                  onMount(() => {
                    if (menuOpen() && canEdit()) element.focus();
                  });
                }}
                type="search"
                readOnly={uploading()}
                value={searchTerm()}
                onInput={(event) => updateSearch(event.currentTarget.value)}
                placeholder="Search KLIPY"
                aria-label="Search GIFs"
              />
              <InputGroup.Addon align="inline-start">
                <MagnifyingGlassIcon aria-hidden="true" />
              </InputGroup.Addon>
            </InputGroup>

            <div
              class="overflow-y-auto overscroll-contain scrollbar-hidden scroll-p-1"
              style={{ height: `${gridMaxHeight()}px` }}
            >
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
                  <div
                    ref={gridRef}
                    class="grid grid-cols-2 auto-rows-28 gap-1.5 p-1"
                  >
                    <For each={gifList()}>
                      {(gif, index) => (
                        <button
                          type="button"
                          disabled={uploading()}
                          aria-label={gif.title}
                          onClick={() =>
                            fireAndForget(insertGif(gif), 'gif-picker')
                          }
                          onPointerEnter={() => selectFromPointer(index())}
                          class={cn(
                            'size-full overflow-hidden rounded-lg bg-ink/5 outline-none disabled:opacity-50',
                            selectedIndex() === index() && 'ring-2 ring-accent'
                          )}
                        >
                          <img
                            crossorigin="anonymous"
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

            <div class="flex items-center justify-between gap-2 px-1">
              <div class="text-xs text-ink-muted" aria-live="polite">
                <Show when={uploading()}>Uploading GIF…</Show>
                <Show when={uploadError()}>
                  <span role="alert">Couldn't insert GIF. Try again.</span>
                </Show>
              </div>
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
