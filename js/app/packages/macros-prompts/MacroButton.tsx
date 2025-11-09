import { TextButton } from '@core/component/TextButton';
import type { FilteredTailwindColors } from 'core/component/TailwindColorPicker';
import { Dynamic } from 'solid-js/web';
import colors from 'tailwindcss/colors';
import type { MacroPrompt } from './macros';

export function MacroButton(props: {
  macro: MacroPrompt & { color: FilteredTailwindColors };
  clickHandler: () => void;
}) {
  return (
    <TextButton
      theme="clear"
      text={props.macro.title}
      icon={() => (
        <Dynamic
          component={props.macro.icon}
          style={{ color: colors[props.macro.color][500] }}
        />
      )}
      onClick={props.clickHandler}
    />
  );
}
