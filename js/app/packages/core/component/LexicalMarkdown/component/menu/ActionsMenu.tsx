import { cn, Panel } from '@ui';
import { type PortalScope, ScopedPortal } from '@core/component/ScopedPortal';
import clickOutside from '@core/directive/clickOutside';
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
  autoRegister,
  CLOSE_ACTION_SEARCH_COMMAND,
  REMOVE_ACTION_SEARCH_COMMAND,
} from '../../plugins';
import { ACTIONS } from '../../plugins/actions/actions';
import type { Action } from '../../plugins/actions/types';
import type { MenuOperations } from '../../shared/inlineMenu';
import { useIsKeyPressActive } from '@core/util/useIsKeyPressActive';
import { useMenuKeyboardNavigation } from './useMenuKeyboardNavigation';

false && clickOutside;
false && floatWithSelection;
false && floatWithElement;

// Panel's p-px border (2px) + py-2 padding (16px)
const PANEL_DECORATION_HEIGHT = 18;

export function ActionsMenuItem(props: {
  action: Action;
  index: number;
  selected: boolean;
  editor: LexicalEditor;
  setIndex: (index: number) => void;
  setOpen: (open: boolean) => void;
}) {
  let itemRef: HTMLDivElement | undefined;

  createEffect(() => {
    if (props.selected && itemRef) {
      itemRef.scrollIntoView({ block: 'nearest' });
    }
  });

  return (
    <div
      ref={itemRef}
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
        const { action, dependencies } = props.action;
        if (action) {
          if (dependencies !== undefined) {
            if (props.editor.hasNodes(dependencies)) {
              action(props.editor);
            } else {
              console.error(
                'Dispatched Action with missing dependencies:',
                props.action
              );
            }
          } else {
            action(props.editor);
          }
        }
        props.setOpen(false);
      }}
      on:mouseover={() => props.setIndex(props.index)}
      class={cn('group flex items-center p-1.5 mx-1.5 rounded-xs', {
        'bg-hover': props.selected,
      })}
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
  /** Extra actions appended to the default action list. */
  additionalActions?: Action[];
  /** IDs of default actions to exclude from the menu. */
  ignoreActionIds?: string[];
}) {
  const { isOpen, setIsOpen } = props.menu;

  const [selectedIndex, setSelectedIndex] = createSignal(0);

  let menuRef!: HTMLDivElement;

  const [mountSelection, setMountSelection] = createSignal<Selection | null>();

  const [menuAvailableHeight, setMenuAvailableHeight] = createSignal<
    number | undefined
  >(undefined);

  // Cap at 256px (16rem) so the menu stays compact when plenty of space is available,
  // and floor at 0 after subtracting Panel decorations.
  const contentMaxHeight = () => {
    const h = menuAvailableHeight();
    if (h === undefined) return undefined;
    return Math.min(256, Math.max(0, h - PANEL_DECORATION_HEIGHT));
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

  const [, setEditorParent] = createSignal<HTMLElement>();
  autoRegister(() =>
    props.editor.registerRootListener(() => {
      setEditorParent(
        props.editor.getRootElement()?.parentElement ?? undefined
      );
    })
  );

  const merged: Action[] = [...ACTIONS];
  for (const override of props.additionalActions ?? []) {
    const idx = merged.findIndex((a) => a.id === override.id);
    if (idx >= 0) merged[idx] = override;
    else merged.push(override);
  }
  const validActions = merged.filter((action) => {
    if (props.ignoreActionIds?.includes(action.id)) return false;
    const { dependencies } = action;
    if (dependencies === undefined || dependencies.length === 0) return true;
    return props.editor.hasNodes(dependencies);
  });

  createEffect(() => {
    setSelectedIndex(0);
    debouncedSetSearchTerm(props.menu.searchTerm().toLowerCase());
  });

  const filteredItems = createMemo(() => {
    return fuzzyFilter(searchTerm(), validActions, (item) =>
      [item.name, ...item.keywords].join(' ')
    );
  });

  const [escapeSpaceState, setEscapeSpaceState] = createSignal<
    'start' | 'single' | null
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
        case 'single':
        case 'start':
          closeMenu();
          return true;
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
          on:touchstart={(e) => e.stopPropagation()}
          ref={menuRef}
        >
          <Panel depth={2} active class="py-2">
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
          </Panel>
        </div>
      </ScopedPortal>
    </Show>
  );
}
