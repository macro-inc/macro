import { getTailwindColor } from '@block-canvas/util/style';
import { Show } from 'solid-js';

type ColorOption = {
  base: string;
  fill: string;
  stroke: string;
};

const selectedStyling = 'bg-active ring-accent ring-2';

export function Swatch(props: {
  option: ColorOption;
  isSelected: boolean;
  onClick: () => void;
}) {
  const isTransparent = () => props.option.fill === 'transparent';

  const backgroundColor = () => {
    if (props.option.fill === 'transparent') return 'transparent';
    return getTailwindColor(props.option.fill);
  };

  const borderColor = () => {
    return getTailwindColor(props.option.stroke);
  };

  return (
    <div
      class={`size-6 flex justify-center items-center rounded-full hover:bg-hover hover-transition-bg hover:ring-2 ${props.isSelected ? selectedStyling : 'hover:ring-edge'} hover:scale-115 transition-transform`}
      classList={{
        'z-1': props.isSelected,
      }}
      onClick={(e) => {
        e.stopPropagation();
        props.onClick();
      }}
    >
      <div
        class={`rounded-full size-5 border-2`}
        classList={{
          'border-2! border-edge relative': props.option.fill === 'transparent',
        }}
        style={{
          'background-color': backgroundColor(),
          'border-color': borderColor(),
        }}
      >
        <Show when={isTransparent()}>
          <div class="absolute inset-0 flex items-center justify-center">
            <div class="w-full h-0.25 bg-failure transform rotate-45" />
          </div>
        </Show>
      </div>
    </div>
  );
}
