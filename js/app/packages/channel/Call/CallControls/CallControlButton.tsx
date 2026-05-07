import {
  createMemo,
  createSignal,
  splitProps,
  type Component,
  type JSX,
} from 'solid-js';
import { cn } from '@ui';
import type { OverrideComponentProps } from '@kobalte/core';

export type CallControlButtonSize = 'sm' | 'md';
export type CallControlButtonVariant = 'default' | 'active' | 'danger';

export const callControlButtonStyles = {
  base: 'flex items-center justify-center outline outline-transarent bg-transparent transition-colors',

  size: {
    sm: 'w-6 h-6 rounded-md',
    md: 'w-10 h-10 rounded-lg',
  },

  variant: {
    default: 'text-ink outline-edge-muted hover:bg-edge/20',
    active: 'text-success outline-success bg-success/25 hover:bg-success/20',
    danger: 'text-failure outline-failure/50 hover:bg-failure hover:text-ink',
  },
};

export type CallControlButtonProps = OverrideComponentProps<
  'button',
  {
    onClick: () => Promise<void> | void;
    active?: boolean;
    danger?: boolean;
    variant?: CallControlButtonVariant;
    children?: JSX.Element;
    disabled?: boolean;
    size?: CallControlButtonSize;
    class?: string;
  }
>;

export const CallControlButton: Component<CallControlButtonProps> = (props) => {
  const [local, others] = splitProps(props, [
    'active',
    'danger',
    'variant',
    'size',
    'onClick',
    'disabled',
    'class',
    'children',
  ]);

  const [isPending, setIsPending] = createSignal(false);
  const interactionDisabled = createMemo(() => isPending() || !!local.disabled);

  const handleClick = async () => {
    if (interactionDisabled()) return;
    setIsPending(true);
    try {
      await local.onClick();
    } catch (e) {
      console.error('ControlButton action failed', e);
    } finally {
      setIsPending(false);
    }
  };

  const size = () => local.size ?? 'md';

  const variant = (): CallControlButtonVariant => {
    if (local.variant) return local.variant;
    if (local.danger) return 'danger';
    if (local.active) return 'active';
    return 'default';
  };

  return (
    <button
      onClick={handleClick}
      disabled={interactionDisabled()}
      class={cn(
        callControlButtonStyles.base,
        callControlButtonStyles.size[size()],
        callControlButtonStyles.variant[variant()],
        interactionDisabled() && 'pointer-events-none opacity-50',
        local.class
      )}
      {...others}
    >
      {local.children}
    </button>
  );
};
