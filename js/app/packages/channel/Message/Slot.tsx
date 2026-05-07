import { cn } from '@ui';
import {
  type ComponentProps,
  type JSX,
  splitProps,
  type ValidComponent,
} from 'solid-js';
import { Dynamic } from 'solid-js/web';

type SlotElement = 'div' | 'span' | 'button';

export type MessageSlotPlacement =
  | 'icon'
  | 'header'
  | 'content'
  | 'footer'
  | 'actions';

type CommonProps = {
  children?: JSX.Element;
  placement: MessageSlotPlacement;
  class?: string;
  style?: JSX.CSSProperties | string;
};

type SlotProps<T extends ValidComponent = 'div'> = { as?: T } & CommonProps &
  Omit<ComponentProps<T>, keyof CommonProps | 'component'>;

function placementStyle(
  placement: MessageSlotPlacement
): Partial<JSX.CSSProperties> {
  switch (placement) {
    case 'icon':
      return { 'grid-area': 'icon' };
    case 'header':
      return { 'grid-area': 'header' };
    case 'content':
      return { 'grid-area': 'content' };
    case 'footer':
      return { 'grid-area': 'footer' };
    case 'actions':
      return { 'grid-area': 'actions' };
  }
}

export function Slot<T extends SlotElement = 'div'>(props: SlotProps<T>) {
  const [local, rest] = splitProps(props, [
    'as',
    'class',
    'children',
    'placement',
    'style',
  ]);

  return (
    <Dynamic
      component={local.as ?? ('div' as SlotElement)}
      class={cn('message-slot min-w-0', local.class)}
      data-message-slot={local.placement}
      style={{
        ...placementStyle(local.placement),
        ...(typeof local.style === 'object' ? local.style : {}),
      }}
      {...rest}
    >
      {local.children}
    </Dynamic>
  );
}
