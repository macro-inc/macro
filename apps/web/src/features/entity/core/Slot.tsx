import { cn } from '@ui';
import { type ComponentProps, type JSX, splitProps } from 'solid-js';

const placeGrid = (
  area: string | [string, string] | undefined
): Partial<JSX.CSSProperties> => {
  if (area === undefined) return {};
  if (typeof area === 'string') {
    return { 'grid-area': area };
  }
  return {
    'grid-column-start': area[0],
    'grid-column-end': area[1],
  };
};

type CommonProps = {
  children?: JSX.Element;
  placement?: string | [string, string];
  class?: string;
  style?: JSX.CSSProperties | string;
};

type SlotProps = CommonProps & Omit<ComponentProps<'div'>, keyof CommonProps>;

export function Slot(props: SlotProps) {
  const [local, rest] = splitProps(props, [
    'class',
    'children',
    'placement',
    'style',
  ]);

  const gridArea = () => placeGrid(local.placement);

  return (
    <div
      class={cn('entity-slot', local.class)}
      style={{
        ...gridArea(),
        ...(typeof local.style === 'object' ? local.style : {}),
      }}
      {...rest}
    >
      {local.children}
    </div>
  );
}
