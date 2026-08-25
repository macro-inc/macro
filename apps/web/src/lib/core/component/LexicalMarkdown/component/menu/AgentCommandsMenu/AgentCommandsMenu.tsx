import { type PortalScope, ScopedPortal } from '@core/component/ScopedPortal';
import clickOutside from '@core/directive/clickOutside';
import { useIsKeyPressActive } from '@core/util/useIsKeyPressActive';
import { cn, Surface } from '@ui';
import type { LexicalEditor } from 'lexical';
import {
  createEffect,
  createSignal,
  For,
  onCleanup,
  onMount,
  Show,
  untrack,
} from 'solid-js';
import { floatWithSelection } from '../../../directive/floatWithSelection';
import {
  type AgentCommandItem,
  CLOSE_AGENT_COMMAND_SEARCH_COMMAND,
  INSERT_AGENT_COMMAND_COMMAND,
} from '../../../plugins/agent-commands';
import type { MenuOperations } from '../../../shared/inlineMenu';
import { useMenuKeyboardNavigation } from '../useMenuKeyboardNavigation';

false && clickOutside;
false && floatWithSelection;

// Height consumed by Surface's border + vertical padding
const PANEL_DECORATION_HEIGHT = 18;

type AgentCommandsMenuProps = {
  editor: LexicalEditor;
  menu: MenuOperations;
  /** Slash commands advertised by the connected agent. */
  commands: () => AgentCommandItem[];
  /** whether the menu checks against block boundary in floating middleware. uses floating-ui default if false. */
  useBlockBoundary?: boolean;
  portalScope?: PortalScope;
};

/**
 * Typeahead menu opened by typing `/` in an agent composer. Lists the slash
 * commands the connected coding agent advertised over ACP; selecting one
 * inserts `/name` as plain text at the cursor — commands travel to the agent
 * as ordinary prompt text.
 */
export function AgentCommandsMenu(props: AgentCommandsMenuProps) {
  const searchTerm = props.menu.searchTerm;
  const activeSearchTerm = () => (props.menu.isOpen() ? searchTerm() : '');

  // Name-prefix matches first, then substring matches on name or description.
  const filteredCommands = () => {
    const term = activeSearchTerm().trim().toLowerCase();
    const all = props.commands();
    if (!term) return all;
    const prefix: AgentCommandItem[] = [];
    const contains: AgentCommandItem[] = [];
    for (const command of all) {
      const name = command.name.toLowerCase();
      if (name.startsWith(term)) {
        prefix.push(command);
      } else if (
        name.includes(term) ||
        command.description.toLowerCase().includes(term)
      ) {
        contains.push(command);
      }
    }
    return [...prefix, ...contains];
  };

  const [selectedIndex, setSelectedIndex] = createSignal(0);
  const [mountSelection, setMountSelection] = createSignal<Selection | null>();
  const [escapeSpaceState, setEscapeSpaceState] = createSignal<
    'start' | 'single' | null
  >('start');

  const { isKeypressActive } = useIsKeyPressActive();
  const setSelectedIndexFromMouse = (index: number) => {
    if (isKeypressActive()) return;
    setSelectedIndex(index);
  };

  const [menuOpen, setMenuOpen] = [props.menu.isOpen, props.menu.setIsOpen];

  createEffect(() => {
    if (menuOpen()) {
      setMountSelection(document.getSelection());
      setSelectedIndex(0);
      setEscapeSpaceState('start');
    } else {
      setMountSelection(null);
    }
  });

  createEffect(() => {
    searchTerm();
    setSelectedIndex(0);
  });

  createEffect(() => {
    const count = filteredCommands().length;
    if (count > 0 && selectedIndex() >= count) {
      setSelectedIndex(count - 1);
    }
  });

  const closeMenu = () => {
    props.editor.dispatchCommand(CLOSE_AGENT_COMMAND_SEARCH_COMMAND, undefined);
    setMenuOpen(false);
  };

  const insertCommand = (command: AgentCommandItem) => {
    props.editor.dispatchCommand(INSERT_AGENT_COMMAND_COMMAND, command);
  };

  useMenuKeyboardNavigation({
    isActive: menuOpen,
    onUp: () => {
      const items = filteredCommands();
      if (items.length === 0) return;
      setSelectedIndex((selectedIndex() - 1 + items.length) % items.length);
    },
    onDown: () => {
      const items = filteredCommands();
      if (items.length === 0) return;
      setSelectedIndex((selectedIndex() + 1) % items.length);
    },
    onLeft: () => {
      // block horizontal arrows
    },
    onRight: () => {
      // block horizontal arrows
    },
    onSelect: () => {
      const selectedItem = filteredCommands()[selectedIndex()];
      if (selectedItem) {
        insertCommand(selectedItem);
      } else {
        closeMenu();
      }
    },
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

  const focusOut = () => {
    closeMenu();
  };
  onMount(() => {
    document.addEventListener('focusout', focusOut);
    onCleanup(() => {
      document.removeEventListener('focusout', focusOut);
    });
  });

  const [menuAvailableHeight, setMenuAvailableHeight] = createSignal<
    number | undefined
  >(undefined);

  const contentMaxHeight = () => {
    const h = menuAvailableHeight();
    if (h === undefined) return 256;
    return Math.min(256, Math.max(0, h - PANEL_DECORATION_HEIGHT));
  };

  return (
    <Show when={menuOpen()}>
      <ScopedPortal scope={props.portalScope}>
        <div
          class="w-96 max-w-[calc(100cqw-1rem-2px)] cursor-default select-none z-modal-content menu-open-animation"
          use:floatWithSelection={{
            selection: untrack(mountSelection),
            reactiveOnContainer: props.editor.getRootElement(),
            useBlockBoundary: props.useBlockBoundary,
            onAvailableHeight: setMenuAvailableHeight,
          }}
          use:clickOutside={() => {
            closeMenu();
          }}
          on:touchstart={(e) => e.stopPropagation()}
        >
          <Surface
            depth={2}
            class="pt-2 pb-1.5 shadow-lg shadow-drop-shadow rounded-xl"
          >
            <div class="px-3.5 pb-1 text-xs font-medium text-ink-muted">
              Commands
            </div>
            <Show
              when={filteredCommands().length > 0}
              fallback={
                <div class="px-3.5 pb-1 text-ink-extra-muted">No results</div>
              }
            >
              <div
                class="overflow-y-auto scrollbar-hidden"
                style={{ 'max-height': `${contentMaxHeight()}px` }}
              >
                <For each={filteredCommands()}>
                  {(command, index) => (
                    <AgentCommandRow
                      command={command}
                      index={index()}
                      selected={index() === selectedIndex()}
                      itemAction={() => insertCommand(command)}
                      setIndex={setSelectedIndexFromMouse}
                    />
                  )}
                </For>
              </div>
            </Show>
          </Surface>
        </div>
      </ScopedPortal>
    </Show>
  );
}

function AgentCommandRow(props: {
  command: AgentCommandItem;
  index: number;
  selected: boolean;
  itemAction: () => void;
  setIndex: (index: number) => void;
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
        props.itemAction();
        e.stopPropagation();
      }}
      on:mousemove={() => props.setIndex(props.index)}
      class={cn('group flex items-baseline gap-2 p-1.5 mx-1.5 rounded-md', {
        'bg-ink/5': props.selected,
      })}
    >
      <span class="shrink-0 text-ink text-xs sm:text-sm font-medium">
        /{props.command.name}
      </span>
      <Show when={props.command.inputHint}>
        <span class="shrink-0 text-xs text-ink-extra-muted">
          {props.command.inputHint}
        </span>
      </Show>
      <span class="min-w-0 truncate text-xs text-ink-muted">
        {props.command.description}
      </span>
    </div>
  );
}
