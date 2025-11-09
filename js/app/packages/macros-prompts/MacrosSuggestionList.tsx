import { TextButton } from '@core/component/TextButton';
import PlusCircleIcon from '@phosphor-icons/core/regular/plus-circle.svg?component-solid';
import { type Accessor, For } from 'solid-js';
import colors from 'tailwindcss/colors';
import {
  type MacroPrompt,
  macros,
  setInputToMacroPrompt,
  // setSelectedMacro,
} from './macros';

export function MacrosSuggestionList(props: {
  inputRef: Accessor<HTMLDivElement | null>;
}) {
  function handleMacroSelection(macro: MacroPrompt) {
    const inputRef_ = props.inputRef();

    // setSelectedMacro(macro);
    setInputToMacroPrompt(inputRef_, macro);
  }

  return (
    <div class="relative flex flex-row gap-2 pt-4">
      <For each={macros()}>
        {(macro) => (
          <TextButton
            theme="clear"
            text={macro.title}
            icon={() => (
              <macro.icon style={{ color: colors[macro.color][500] }} />
            )}
            onClick={() => handleMacroSelection(macro)}
          />
        )}
      </For>
      <TextButton
        theme="clear"
        text="New Macro"
        icon={() => <PlusCircleIcon />}
      />
    </div>
  );
}
