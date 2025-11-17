import { BozzyBracketInnerSibling } from '@core/component/BozzyBracket';
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

false && clickOutside;
false && floatWithSelection;
false && floatWithElement;

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

  const handleKeyDown = (e: KeyboardEvent) => {
    if (!isOpen()) return;

    const items = filteredItems();
    const selectedItem = items[selectedIndex()];

    switch (e.key) {
      case ' ':
        switch (escapeSpaceState()) {
          case 'double':
          case 'start':
            props.editor.dispatchCommand(
              CLOSE_ACTION_SEARCH_COMMAND,
              undefined
            );
            setIsOpen(false);
            break;
          case 'single':
            setEscapeSpaceState('double');
            break;
          case null:
            setEscapeSpaceState('single');
            break;
        }
        break;

      case 'Escape':
        e.preventDefault();
        e.stopPropagation();
        props.editor.dispatchCommand(CLOSE_ACTION_SEARCH_COMMAND, undefined);
        setIsOpen(false);
        break;

      case 'ArrowDown':
        e.preventDefault();
        e.stopPropagation();
        setSelectedIndex((prev) => (prev + 1) % items.length);
        break;

      case 'ArrowUp':
        e.preventDefault();
        e.stopPropagation();
        setSelectedIndex((prev) => (prev - 1 + items.length) % items.length);
        break;

      case 'ArrowLeft':
      case 'ArrowRight':
        e.preventDefault();
        break;

      case 'Tab':
        e.preventDefault();
        e.stopPropagation();
        if (e.shiftKey) {
          setSelectedIndex((prev) => (prev - 1 + items.length) % items.length);
        } else {
          setSelectedIndex((prev) => (prev + 1) % items.length);
        }
        break;

      case 'Enter':
        e.preventDefault();
        e.stopPropagation();
        props.editor.dispatchCommand(REMOVE_ACTION_SEARCH_COMMAND, undefined);
        if (selectedItem) {
          selectedItem.action(props.editor);
        }
        setIsOpen(false);
        break;

      default:
        setEscapeSpaceState(null);
        break;
    }
  };

  onMount(() => {
    document.addEventListener('keydown', handleKeyDown, { capture: true });
    onCleanup(() => {
      document.removeEventListener('keydown', handleKeyDown, { capture: true });
    });

    const focusOut = () => {
      props.editor.dispatchCommand(CLOSE_ACTION_SEARCH_COMMAND, undefined);
      setIsOpen(false);
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
                setIndex={setSelectedIndex}
                setOpen={setIsOpen}
              />
            );
          }}
        </For>
      </Show>
    );
  });

  const clickOutsideHandler = () => {
    props.editor.dispatchCommand(CLOSE_ACTION_SEARCH_COMMAND, undefined);
    setIsOpen(false);
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
          <div class="relative overflow-hidden ring-1 ring-edge bg-menu shadow-xl py-2">
            {inner()}
          </div>
          <BozzyBracketInnerSibling animOnOpen={true} />
        </div>
      </ScopedPortal>
    </Show>
  );
}
