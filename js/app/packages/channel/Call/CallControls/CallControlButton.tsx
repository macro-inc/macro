import {
  createMemo,
  createSignal,
  type Component,
  type JSX,
} from 'solid-js';
import { cn } from '@ui/utils/classname';

export type CallControlVariant = 'default' | 'panel' | 'panel-small';

export const CallControlButton: Component<{
  onClick: () => Promise<void> | void;
  active?: boolean;
  danger?: boolean;
  /**
   * Same layout as `danger`, but accent tokens: `default` pill uses
   * `border-accent-2/50 bg-accent-2/10 hover:bg-accent-2/40` (mirrors
   * `failure/50`, `/10`, `/40`); `panel` uses `text-accent` like `text-failure`
   * on `danger`.
   */
  accent?: boolean;
  children?: JSX.Element;
  disabled?: boolean;
  /** `default`: bordered pill. `panel`: flat; icon `text-*` matches default border/bg tokens. */
  variant?: CallControlVariant;
}> = (props) => {
  const [isPending, setIsPending] = createSignal(false);
  // Do not destructure `disabled` / `active` — Solid only tracks `props.*` reads.
  const interactionDisabled = createMemo(
    () => isPending() || !!props.disabled
  );

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

  const resolvedVariant = () => props.variant ?? 'default';
  const isPanelVariant = () => {
    const v = resolvedVariant();
    return v === 'panel' || v === 'panel-small';
  };

  return (
    <button
      onClick={handleClick}
      disabled={interactionDisabled()}
      class={cn(
        'flex items-center justify-center transition-colors cursor-pointer',
        interactionDisabled() && 'opacity-50 pointer-events-none border border-edge-muted',
        resolvedVariant() === 'default' &&
          cn(
            'w-10 h-10 rounded-lg',
            !interactionDisabled() &&
              props.danger &&
              'border border-failure/50 bg-failure/10 hover:bg-failure/40',
            !interactionDisabled() &&
              props.accent &&
              !props.danger &&
              !props.active &&
              'border border-accent/50 bg-accent/10 hover:bg-accent/40',
            !interactionDisabled() &&
              !props.danger &&
              props.active &&
              'border border-accent-2 hover:bg-accent-2/40 text-accent-2',
            !interactionDisabled() &&
              !props.danger &&
              !props.active &&
              !props.accent &&
              'border border-edge-muted bg-surface-2/70 hover:bg-surface-2/40'
          ),
        isPanelVariant() &&
          cn(
            'w-8 h-8 rounded-md border-0 bg-transparent shadow-none',
            !interactionDisabled() &&
              props.danger &&
              'text-failure hover:text-failure/90',
            !interactionDisabled() &&
              props.accent &&
              !props.danger &&
              !props.active &&
              'text-accent hover:text-accent/90',
            !interactionDisabled() &&
              !props.danger &&
              !props.accent &&
              !props.active &&
              'text-ink',
            !interactionDisabled() &&
              !props.danger &&
              props.active &&
              'text-accent-2'
          )
      )}
    >
      {props.children}
    </button>
  );
};
