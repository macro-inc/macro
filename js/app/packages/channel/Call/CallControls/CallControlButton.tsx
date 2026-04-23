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
  callControlPanelIdle,
  callControlPressable,
} from './call-control-button-shared';

export type CallControlVariant = 'default' | 'panel' | 'panel-small';

export const CallControlButton: Component<{
  onClick: () => Promise<void> | void;
  active?: boolean;
  danger?: boolean;
  children?: JSX.Element;
  disabled?: boolean;
  variant?: CallControlVariant;
}> = (props) => {
  const [isPending, setIsPending] = createSignal(false);
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
          'pointer-events-none opacity-50',
        resolvedVariant() === 'default' &&
          cn(
            callControlDefaultSize,
            props.danger && callControlDefaultDanger,
            !props.danger && props.active && callControlDefaultActive,
            !props.danger && !props.active && callControlDefaultIdle
          ),
        isPanelVariant() &&
          cn(
            'h-8 w-8',
            callControlPanelFlat,
            props.danger && callControlPanelDanger,
            !props.danger && !props.active && callControlPanelIdle,
            !props.danger && props.active && callControlPanelActive
          )
      )}
    >
      {props.children}
    </button>
  );
};
