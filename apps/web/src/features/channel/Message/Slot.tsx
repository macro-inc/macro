import { cn } from '@ui';
import { type ComponentProps, type JSX, splitProps } from 'solid-js';

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

type SlotProps = CommonProps & Omit<ComponentProps<'div'>, keyof CommonProps>;

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

export function Slot(props: SlotProps) {
  const [local, rest] = splitProps(props, [
    'class',
    'children',
    'placement',
    'style',
  ]);

  return (
    <div
      class={cn('message-slot min-w-0', local.class)}
      data-message-slot={local.placement}
      style={{
        ...placementStyle(local.placement),
        ...(typeof local.style === 'object' ? local.style : {}),
      }}
      {...rest}
    >
      {local.children}
    </div>
  );
}
