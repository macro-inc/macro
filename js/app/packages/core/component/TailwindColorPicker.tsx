import { OldMenu, OldMenuItem } from '@core/component/OldMenu';
import Circle from '@phosphor-icons/core/regular/circle.svg?component-solid';
import { type Accessor, For, onCleanup, onMount } from 'solid-js';
import colors from 'tailwindcss/colors';

export const FilteredTailwindColors = {
  gray: 'gray',
  red: 'red',
  orange: 'orange',
  yellow: 'yellow',
  green: 'green',
  teal: 'teal',
  blue: 'blue',
  indigo: 'indigo',
  purple: 'purple',
  pink: 'pink',
} as const;

export type FilteredTailwindColors = keyof typeof FilteredTailwindColors;

export interface TailwindColorPickerProps {
  onColorSelect: (color: FilteredTailwindColors) => void;
  show: Accessor<boolean>;
  setShow: (show: boolean) => void;
}

export const TailwindColorPicker = (props: TailwindColorPickerProps) => {
  let menuRef: HTMLDivElement | undefined;

  function handleOutsideClick(event: MouseEvent) {
    if (menuRef && !menuRef.contains(event.target as Node)) {
      props.setShow(false);
    }
  }

  onMount(() => {
    document.addEventListener('mousedown', handleOutsideClick);
    onCleanup(() => {
      document.removeEventListener('mousedown', handleOutsideClick);
    });
  });

  function handleColorSelect(color: FilteredTailwindColors) {
    props.onColorSelect(color);
    props.setShow(false);
  }

  return (
    <div ref={menuRef}>
      <OldMenu width="sm">
        <For each={Object.values(FilteredTailwindColors)}>
          {(color) => (
            <OldMenuItem
              text={color}
              icon={() => (
                <Circle style={{ color: colors[color][500] }} class="w-full" />
              )}
              onClick={() => handleColorSelect(color)}
            />
          )}
        </For>
      </OldMenu>
    </div>
  );
};
