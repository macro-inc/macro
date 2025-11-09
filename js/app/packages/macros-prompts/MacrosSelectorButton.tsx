import { IconButton } from '@core/component/IconButton';
import { MENU_ITEM_HEIGHT } from '@core/component/Menu';
import { OldMenu, OldMenuItem } from '@core/component/OldMenu';
import LightningIcon from '@phosphor-icons/core/regular/lightning.svg?component-solid';
import SearchIcon from '@phosphor-icons/core/regular/magnifying-glass.svg?component-solid';
import PencilIcon from '@phosphor-icons/core/regular/pencil.svg?component-solid';
import PlusIcon from '@phosphor-icons/core/regular/plus.svg?component-solid';
import {
  type Accessor,
  createMemo,
  createSignal,
  For,
  onCleanup,
  onMount,
  Show,
} from 'solid-js';
import colors from 'tailwindcss/colors';
import {
  ENABLE_EDIT_MACROS,
  ENABLE_SEARCH_MACROS,
  type MacroPrompt,
  macroSignal,
  macros,
  setInputToMacroPrompt,
  setMacroModalState,
} from './macros';

interface MacrosMenuProps {
  onMacroSelected: (macro: MacroPrompt) => void;
  macros: MacroPrompt[];
  setShow: (show: boolean) => void;
}

/*
 * This is such a non-standard menu that instead of bringing it up to our new menu best practices, I just threw in the old menu components.
 * TODO: Redesign this menu to use best practices.
 */
export function MacrosMenu(props: MacrosMenuProps) {
  let menuRef: HTMLDivElement | undefined;
  const [searchQuery, setSearchQuery] = createSignal('');

  function handleOutsideClick(event: MouseEvent) {
    if (menuRef && !menuRef.contains(event.target as Node)) {
      props.setShow(false);
    }
  }

  // TODO- use: directive
  onMount(() => {
    document.addEventListener('mousedown', handleOutsideClick);
    onCleanup(() => {
      document.removeEventListener('mousedown', handleOutsideClick);
    });
  });

  const filteredMacros = createMemo(() => {
    const query = searchQuery().toLowerCase();
    return props.macros.filter((macro) =>
      macro.title.toLowerCase().includes(query)
    );
  });

  const menuVerticalStartPosition = createMemo(() => {
    const startOffset = 16;
    const addPromptHeight = MENU_ITEM_HEIGHT;
    const searchBoxHeight = 40; // Height of search input + padding
    const macrosListHeight = Math.min(
      200,
      filteredMacros().length * MENU_ITEM_HEIGHT
    );
    const dividerPadding = filteredMacros().length > 0 ? 9 : 0;

    return (
      startOffset +
      addPromptHeight +
      searchBoxHeight +
      macrosListHeight +
      dividerPadding
    );
  });

  return (
    <div
      ref={menuRef}
      class="absolute bg-menu flex flex-col rounded-md left-0 z-selector-menu"
      style={{ top: `-${menuVerticalStartPosition()}px` }}
    >
      <OldMenu width="lg">
        <OldMenuItem
          text="Add Prompt"
          icon={PlusIcon}
          onClick={() => {
            setMacroModalState({ type: 'create' });
            props.setShow(false);
          }}
          spacerBottom={filteredMacros().length > 0}
        />

        <div class="flex w-full p-1">
          <input
            type="text"
            placeholder="Search prompts..."
            value={searchQuery()}
            onInput={(e) => setSearchQuery(e.currentTarget.value)}
            class="w-full px-2 py-1 text-sm rounded bg-input ring-1 ring-edge"
          />
        </div>

        <div class="max-h-[200px] overflow-y-auto w-full">
          <For each={filteredMacros()}>
            {(macro) => (
              <OldMenuItem
                text={macro.title}
                icon={() => (
                  <macro.icon style={{ color: colors[macro.color][500] }} />
                )}
                onClick={() => props.onMacroSelected(macro)}
                secondaryActionHandler={
                  ENABLE_EDIT_MACROS
                    ? (e) => {
                        e.stopPropagation();
                        setMacroModalState({ type: 'edit', macro });
                        props.setShow(false);
                      }
                    : undefined
                }
                secondaryIcon={ENABLE_EDIT_MACROS ? PencilIcon : undefined}
              />
            )}
          </For>
        </div>

        {ENABLE_SEARCH_MACROS && (
          <OldMenuItem
            text="Search Macros"
            icon={SearchIcon}
            onClick={() => {}}
          />
        )}
      </OldMenu>
    </div>
  );
}

interface MacrosSelectorButtonProps {
  inputRef: Accessor<HTMLDivElement | null>;
}

export function MacrosSelectorButton(props: MacrosSelectorButtonProps) {
  const [showMacrosSelector, setShowMacrosSelector] = createSignal(false);
  const setSelectedMacro = macroSignal.set;
  const selectedMacro = macroSignal.get;

  const toggleShowMacrosSelector = () => {
    if (showMacrosSelector()) {
      setShowMacrosSelector(false);
      return;
    }
    setShowMacrosSelector(true);
  };

  function handleMacroSelection(macro: MacroPrompt) {
    const inputRef_ = props.inputRef();
    setSelectedMacro(macro);
    setShowMacrosSelector(false);
    setInputToMacroPrompt(inputRef_, macro);
  }

  const buttonIcon = createMemo(() => {
    const macro = selectedMacro();
    if (macro) {
      // Return a component that wraps the icon with styling
      return (props: any) => (
        <macro.icon {...props} style={{ color: colors[macro.color][500] }} />
      );
    }
    return LightningIcon;
  });

  // TODO- use solid portal for the menu
  // TODO- https://www.solidjs.com/tutorial/bindings_directives for click outside
  return (
    <div>
      <Show when={showMacrosSelector() && macros()}>
        <MacrosMenu
          onMacroSelected={handleMacroSelection}
          macros={macros()}
          setShow={setShowMacrosSelector}
        />
      </Show>
      <IconButton
        theme="clear"
        icon={buttonIcon()}
        onClick={toggleShowMacrosSelector}
      />
    </div>
  );
}
