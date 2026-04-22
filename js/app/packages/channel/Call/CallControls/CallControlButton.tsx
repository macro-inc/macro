import {
  createMemo,
  createSignal,
  type Component,
  type JSX,
} from 'solid-js';
import { cn } from '@ui/utils/classname';
import {
  callControlDefaultActive,
  callControlDefaultDanger,
  callControlDefaultIdle,
  callControlDefaultSize,
  callControlPanelActive,
  callControlPanelDanger,
  callControlPanelFlat,
  callControlPanelHoverBg,
  callControlPanelIdle,
  callControlPressable,
} from './callControlButtonShared';

export type CallControlVariant = 'default' | 'panel' | 'panel-small';

export const CallControlButton: Component<{
  onClick: () => Promise<void> | void;
  active?: boolean;
  danger?: boolean;
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
        callControlPressable,
        interactionDisabled() &&
          'opacity-50 pointer-events-none border border-edge-muted',
        resolvedVariant() === 'default' &&
          cn(
            callControlDefaultSize,
            !interactionDisabled() &&
              props.danger &&
              callControlDefaultDanger,
            !interactionDisabled() &&
              !props.danger &&
              props.active &&
              callControlDefaultActive,
            !interactionDisabled() &&
              !props.danger &&
              !props.active &&
              callControlDefaultIdle
          ),
        isPanelVariant() &&
          cn(
            'h-8 w-8',
            callControlPanelFlat,
            callControlPanelHoverBg,
            !interactionDisabled() &&
              props.danger &&
              callControlPanelDanger,
            !interactionDisabled() &&
              !props.danger &&
              !props.active &&
              callControlPanelIdle,
            !interactionDisabled() &&
              !props.danger &&
              props.active &&
              callControlPanelActive
          )
      )}
    >
      {props.children}
    </button>
  );
};
