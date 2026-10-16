import { createSignal, type JSX, onCleanup, splitProps } from 'solid-js';
import { cn } from '../utils/classname';
import { Button, type ButtonProps } from './Button';

export type HoldButtonProps = Omit<ButtonProps, 'onClick'> & {
  /** How long the button must stay pressed before `onConfirm` runs, in ms. */
  duration: number;
  /** Runs once when a press lasts the full `duration`. */
  onConfirm: () => void;
};

const RELEASE_MS = 150;

/**
 * Button that only fires after it is held down for `duration`. A fill sweeps
 * across while held; releasing, leaving, or cancelling early resets it.
 * Pointer and keyboard (Space or Enter) presses both count.
 *
 * @do Use for irreversible actions that people trigger by accident.
 * @do Say "Hold" in the label so the gesture is discoverable.
 * @dont Use for routine confirmations; a confirm dialog is enough there.
 */
export function HoldButton(props: HoldButtonProps) {
  const [local, rest] = splitProps(props, [
    'duration',
    'onConfirm',
    'children',
    'class',
  ]);
  const [holding, setHolding] = createSignal(false);
  let timer: ReturnType<typeof setTimeout> | undefined;

  function release() {
    clearTimeout(timer);
    timer = undefined;
    setHolding(false);
  }

  function press() {
    if (props.disabled || timer !== undefined) return;
    setHolding(true);
    timer = setTimeout(() => {
      release();
      local.onConfirm();
    }, local.duration);
  }

  onCleanup(release);

  const isHoldKey = (event: KeyboardEvent) =>
    event.key === ' ' || event.key === 'Enter';

  const onKeyDown: JSX.EventHandler<HTMLButtonElement, KeyboardEvent> = (
    event
  ) => {
    if (!isHoldKey(event)) return;
    event.preventDefault();
    if (!event.repeat) press();
  };

  const onKeyUp: JSX.EventHandler<HTMLButtonElement, KeyboardEvent> = (
    event
  ) => {
    if (!isHoldKey(event)) return;
    event.preventDefault();
    release();
  };

  return (
    <Button
      {...rest}
      data-holding={holding() ? '' : undefined}
      class={cn('overflow-hidden touch-none', local.class)}
      onPointerDown={(event) => {
        if (event.button > 0) return;
        press();
      }}
      onPointerUp={release}
      onPointerLeave={release}
      onPointerCancel={release}
      onBlur={release}
      onKeyDown={onKeyDown}
      onKeyUp={onKeyUp}
      onContextMenu={(event) => event.preventDefault()}
    >
      <span
        aria-hidden="true"
        data-hold-progress
        class="pointer-events-none absolute inset-0 origin-left bg-current opacity-15"
        style={{
          transform: `scaleX(${holding() ? 1 : 0})`,
          transition: `transform ${holding() ? local.duration : RELEASE_MS}ms linear`,
        }}
      />
      {local.children}
    </Button>
  );
}
