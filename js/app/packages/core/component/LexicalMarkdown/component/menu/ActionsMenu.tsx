import { ClippedPanel } from '@core/component/ClippedPanel';
import { type PortalScope, ScopedPortal } from '@core/component/ScopedPortal';
import clickOutside from '@core/directive/clickOutside';
import { isMobileWidth } from '@core/mobile/mobileWidth';
import { fuzzyFilter } from '@core/util/fuzzy';
import { debounce } from '@solid-primitives/scheduled';
import type { LexicalEditor } from 'lexical';
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  onCleanup,
  onMount,
  Show,
  untrack,
} from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { floatWithElement } from '../../directive/floatWithElement';
import { floatWithSelection } from '../../directive/floatWithSelection';
import {
  CLOSE_ACTION_SEARCH_COMMAND,
  REMOVE_ACTION_SEARCH_COMMAND,
} from '../../plugins';
import { ACTIONS, type Action } from '../../plugins/actions/actions';
import type { MenuOperations } from '../../shared/inlineMenu';
import { useIsKeyPressActive } from '@core/util/useIsKeyPressActive';
import { useMenuKeyboardNavigation } from './useMenuKeyboardNavigation';

false && clickOutside;
false && floatWithSelection;
false && floatWithElement;

// py-2 on the menu container = 8px top + 8px bottom
const MENU_DECORATION_HEIGHT = 16;

export function ActionsMenuItem(props: {
  action: Action;
  index: number;
  selected: boolean;
  editor: LexicalEditor;
  setIndex: (index: number) => void;
  setOpen: (open: boolean) => void;
}) {
  return (
    <div
      on:mouseup={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      on:mousedown={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      on:click={(e) => {
        e.preventDefault();
        e.stopPropagation();
        props.editor.dispatchCommand(REMOVE_ACTION_SEARCH_COMMAND, undefined);
        const action = props.action.action;
        if (action) {
          action(props.editor);
        }
        props.setOpen(false);
      }}
      on:mouseover={() => props.setIndex(props.index)}
      class="p-1 mx-1.5"
      classList={{ 'bg-active bracket': props.selected }}
    >
      <div class="flex flex-row gap-2 items-center w-full">
        <div class="size-6 flex items-center justify-center text-ink-extra-muted">
          <Dynamic component={props.action.icon} class="size-4" />
        </div>
        <p class=" text-sm text-ink font-medium flex-1 grow">
          {props.action.name}
        </p>
        <Show when={props.action.shortcut}>
          <p class="text-xs text-ink-extra-muted">{props.action.shortcut}</p>
        </Show>
      </div>
    </div>
  );
}

export function ActionMenu(props: {
  editor: LexicalEditor;
  menu: MenuOperations;
  anchor?: HTMLElement | null;
  portalScope?: PortalScope;
  /** whether the menu checks against block boundary in floating middleware. uses floating-ui default if false. */
  useBlockBoundary?: boolean;
}) {
  const { isOpen, setIsOpen } = props.menu;

  const [selectedIndex, setSelectedIndex] = createSignal(0);
  let menuRef!: HTMLDivElement;
  const [mountSelection, setMountSelection] = createSignal<Selection | null>();
  const [menuAvailableHeight, setMenuAvailableHeight] = createSignal<
    number | undefined
  >(undefined);
  const contentMaxHeight = () => {
    const h = menuAvailableHeight();
    if (h === undefined) return undefined;
    return Math.max(0, h - MENU_DECORATION_HEIGHT);
  };

  const { isKeypressActive } = useIsKeyPressActive();
  const setSelectedIndexFromMouse = (index: number) => {
    if (isKeypressActive()) return;
    setSelectedIndex(index);
  };

  const [searchTerm, setSearchTerm] = createSignal(props.menu.searchTerm());
  const debouncedSetSearchTerm = debounce(
    (term: string) => setSearchTerm(term),
    60
  );

  const maxItems = () => {
    return isMobileWidth() ? 4 : 8;
  };

  const [, setEditorParent] = createSignal<HTMLElement>();
  const cleanupRootListener = props.editor.registerRootListener(() => {
    setEditorParent(props.editor.getRootElement()?.parentElement ?? undefined);
  });
  onCleanup(cleanupRootListener);

  createEffect(() => {
    setSelectedIndex(0);
    debouncedSetSearchTerm(props.menu.searchTerm().toLowerCase());
  });

  const filteredItems = createMemo(() => {
    return fuzzyFilter(searchTerm(), ACTIONS, (item) =>
      [item.name, ...item.keywords].join(' ')
    ).slice(0, maxItems());
  });

  const [escapeSpaceState, setEscapeSpaceState] = createSignal<
    'start' | 'single' | 'double' | null
  >('start');
  createEffect(() => {
    if (!isOpen()) {
      setEscapeSpaceState('start');
    }
  });

  createEffect(() => {
    if (props.anchor) return;
    if (isOpen()) {
      setMountSelection(document.getSelection());
      setSelectedIndex(0);
    } else {
      setMountSelection(null);
    }
  });

  const closeMenu = () => {
    props.editor.dispatchCommand(CLOSE_ACTION_SEARCH_COMMAND, undefined);
    setIsOpen(false);
  };

  const selectCurrentItem = () => {
    const items = filteredItems();
    const selectedItem = items[selectedIndex()];
    props.editor.dispatchCommand(REMOVE_ACTION_SEARCH_COMMAND, undefined);
    if (selectedItem) {
      selectedItem.action(props.editor);
    }
    setIsOpen(false);
  };

  useMenuKeyboardNavigation({
    isActive: isOpen,
    onUp: () => {
      const items = filteredItems();
      setSelectedIndex((prev) => (prev - 1 + items.length) % items.length);
    },
    onDown: () => {
      const items = filteredItems();
      setSelectedIndex((prev) => (prev + 1) % items.length);
    },
    onLeft: () => {},
    onRight: () => {},
    onSelect: selectCurrentItem,
    onClose: closeMenu,
    onSpace: () => {
      switch (escapeSpaceState()) {
        case 'double':
        case 'start':
          closeMenu();
          return true;
        case 'single':
          setEscapeSpaceState('double');
          return false;
        case null:
          setEscapeSpaceState('single');
          return false;
      }
      return false;
    },
    onOtherKey: () => {
      setEscapeSpaceState(null);
    },
  });

  onMount(() => {
    const focusOut = () => {
      closeMenu();
    };
    document.addEventListener('focusout', focusOut);
    onCleanup(() => {
      document.removeEventListener('focusout', focusOut);
    });
  });

  createEffect(() => {
    if (selectedIndex() >= filteredItems().length) {
      setSelectedIndex(filteredItems().length - 1);
    }
  });

  const inner = createMemo(() => {
    return (
      <Show
        when={filteredItems().length > 0}
        fallback={
          <div class="px-2 text text-ink-muted text-sm">No results</div>
        }
      >
        <For each={filteredItems()}>
          {(item, index) => {
            return (
              <ActionsMenuItem
                action={item}
                index={index()}
                selected={index() === selectedIndex()}
                editor={props.editor}
                setIndex={setSelectedIndexFromMouse}
                setOpen={setIsOpen}
              />
            );
          }}
        </For>
      </Show>
    );
  });

  const clickOutsideHandler = () => {
    closeMenu();
  };

  const floatWithElementProps = () =>
    props.anchor
      ? {
          element: () => props.anchor,
          useBlockBoundary: props.useBlockBoundary,
        }
      : undefined;

  const floatWithSelectionProps = () =>
    !props.anchor
      ? {
          selection: untrack(mountSelection),
          reactiveOnContainer: props.editor.getRootElement(),
          useBlockBoundary: props.useBlockBoundary,
          onAvailableHeight: setMenuAvailableHeight,
        }
      : undefined;

  return (
    <Show when={isOpen()}>
      <ScopedPortal scope={props.portalScope}>
        <div
          class="w-60 cursor-default select-none z-modal-content"
          use:floatWithElement={floatWithElementProps()}
          use:floatWithSelection={floatWithSelectionProps()}
          use:clickOutside={clickOutsideHandler}
          ref={menuRef}
        >
          <ClippedPanel active class="py-2 bg-panel" cornerRadius={'4px'}>
            <div
              class="overflow-y-auto scrollbar-hidden"
              style={{
                'max-height':
                  contentMaxHeight() !== undefined
                    ? `${contentMaxHeight()}px`
                    : undefined,
              }}
            >
              {inner()}
            </div>
          </ClippedPanel>
        </div>
      </ScopedPortal>
    </Show>
  );
}
