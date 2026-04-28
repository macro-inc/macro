import { createMemo, createSignal, type Component, type JSX } from 'solid-js';
import { cn } from '@ui/utils/classname';

const panelHoverOpacity =
  'transition-opacity duration-150 opacity-100 hover:opacity-70';

export type CallControlButtonSize = 'default' | 'panel';

export const callControlButtonStyles = {
  base: 'flex items-center justify-center transition-colors cursor-pointer',

  size: {
    default: 'h-10 w-10 rounded-lg',
    panel: cn('h-8 w-8', 'border-0 bg-transparent shadow-none'),
  },

  variant: {
    default: {
      base: 'border border-edge-muted bg-transparent hover:bg-edge/20 text-ink',
      active:
        'border border-success bg-success/25 text-success transition-colors hover:bg-success/40',
      danger:
        'border border-failure/50 bg-transparent text-failure transition-colors hover:bg-failure hover:text-ink',
    },
    panel: {
      base: cn('text-ink', panelHoverOpacity),
      active: cn('text-success', panelHoverOpacity),
      danger: cn('text-failure hover:text-failure/90', panelHoverOpacity),
    },
  },
};

export const CallControlButton: Component<{
  onClick: () => Promise<void> | void;
  active?: boolean;
  danger?: boolean;
  children?: JSX.Element;
  disabled?: boolean;
  size?: CallControlButtonSize;
}> = (props) => {
  const [isPending, setIsPending] = createSignal(false);
  const interactionDisabled = createMemo(() => isPending() || !!props.disabled);

  const handleClick = async () => {
    if (interactionDisabled()) return;
    setIsPending(true);
    try {
      await props.onClick();
    } catch (e) {
      console.error('ControlButton action failed', e);
    } finally {
      setIsPending(false);
    }
  };

  const size = () => props.size ?? 'default';

  const variantClass = () => {
    const sizeVariant = callControlButtonStyles.variant[size()];
    if (props.danger) return sizeVariant.danger;
    if (props.active) return sizeVariant.active;
    return sizeVariant.base;
  };

  return (
    <button
      onClick={handleClick}
      disabled={interactionDisabled()}
      class={cn(
        callControlButtonStyles.base,
        callControlButtonStyles.size[size()],
        variantClass(),
        interactionDisabled() && 'pointer-events-none opacity-50'
      )}
    >
      {props.children}
    </button>
  );
};
