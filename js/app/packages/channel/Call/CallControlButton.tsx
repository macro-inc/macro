import { createSignal, type Component, type JSX } from 'solid-js';
import { cn } from '@ui/utils/classname';

export type CallControlVariant = 'default' | 'panel';

export const CallControlButton: Component<{
  onClick: () => Promise<void> | void;
  active?: boolean;
  danger?: boolean;
  children?: JSX.Element;
  disabled?: boolean;
  /** `default`: bordered pill. `panel`: flat; icon `text-*` matches default border/bg tokens. */
  variant?: CallControlVariant;
}> = (incoming) => {
  const {
    onClick,
    children,
    variant: variantProp,
    active,
    danger,
    disabled: disabledProp,
  } = incoming;

  const resolvedVariant = variantProp ?? 'default';
  const [isPending, setIsPending] = createSignal(false);
  const isInteractionDisabled = () => isPending() || !!disabledProp;

  const handleClick = async () => {
    if (isInteractionDisabled()) return;
    setIsPending(true);
    try {
      await onClick();
    } catch (e) {
      console.error('ControlButton action failed', e);
    } finally {
      setIsPending(false);
    }
  };

  const interactionDisabled = isInteractionDisabled();

  return (
    <button
      onClick={handleClick}
      disabled={interactionDisabled}
      class={cn(
        'flex items-center justify-center transition-colors cursor-pointer',
        interactionDisabled && 'opacity-50 pointer-events-none',
        resolvedVariant === 'default' &&
          cn(
            'w-10 h-10 rounded-lg',
            !interactionDisabled &&
              danger &&
              'border border-failure/50 bg-failure/10 hover:bg-failure/40',
            !interactionDisabled &&
              !danger &&
              !active &&
              'border border-edge-muted bg-surface-2/70 hover:bg-surface-2/40',
            !interactionDisabled &&
              !danger &&
              active &&
              'border border-accent-2 hover:bg-accent-2/40'
          ),
        resolvedVariant === 'panel' &&
          cn(
            'w-8 h-8 rounded-md border-0 bg-transparent shadow-none',
            !interactionDisabled &&
              danger &&
              'text-failure hover:text-failure/90',
            !interactionDisabled &&
              !danger &&
              !active &&
              'text-ink',
            !interactionDisabled && !danger && active && 'text-accent-2'
          )
      )}
    >
      {children}
    </button>
  );
};
