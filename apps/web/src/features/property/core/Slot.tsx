import { cn } from '@ui';
import {
  type ComponentProps,
  type JSX,
  splitProps,
  type ValidComponent,
} from 'solid-js';
import { Dynamic } from 'solid-js/web';

type SlotElement = 'div' | 'span' | 'button';

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

type SlotProps<T extends ValidComponent = 'div'> = { as?: T } & CommonProps &
  Omit<ComponentProps<T>, keyof CommonProps | 'component'>;

export function Slot<T extends SlotElement = 'div'>(props: SlotProps<T>) {
  const [local, rest] = splitProps(props, [
    'as',
    'class',
    'children',
    'placement',
    'style',
  ]);

  const gridArea = () => placeGrid(local.placement);

  return (
    <Dynamic
      class={cn('property-slot', local.class)}
      component={local.as ?? ('div' as SlotElement)}
      style={{
        ...gridArea(),
        ...(typeof local.style === 'object' ? local.style : {}),
      }}
      {...rest}
    >
      {local.children}
    </Dynamic>
  );
}
