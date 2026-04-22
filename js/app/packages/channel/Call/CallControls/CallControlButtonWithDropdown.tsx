import { DropdownMenu } from '@kobalte/core/dropdown-menu';
import { DropdownMenuContent } from '@core/component/Menu';
import CaretDown from '@icon/regular/caret-down.svg';
import { createMemo, createSignal, type JSX } from 'solid-js';
import { cn } from '@ui/utils/classname';
import type { CallControlVariant } from './CallControlButton';
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
} from './callControlButtonShared';

export function CallControlButtonWithDropdown(props: {
  onClick: () => Promise<void> | void;
  active?: boolean;
  danger?: boolean;
  children?: JSX.Element;
  dropdownContent: () => JSX.Element;
  disabled?: boolean;
  variant?: CallControlVariant;
}) {
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

  const defaultVariant = createMemo(() => {
    return resolvedVariant() === 'default';
  });

  const defaultActive = createMemo(() => {
    return defaultVariant() && props.active;
  });

  const isPanelVariant = () => {
    const v = resolvedVariant();
    return v === 'panel' || v === 'panel-small';
  };

  const panelChrome = () =>
    cn(
      props.danger && callControlPanelDanger,
      !props.danger && !props.active && callControlPanelIdle,
      !props.danger && props.active && callControlPanelActive
    );

  return (
    <div
      class={cn(
        'isolate flex items-center transition-colors',
        defaultVariant() &&
          cn(
            'rounded-lg gap-1 pr-2',
            props.danger && callControlDefaultDanger,
            !props.danger && defaultActive() && callControlDefaultActive,
            !props.danger && !defaultActive() && callControlDefaultIdle,
            interactionDisabled() && 'pointer-events-none opacity-50'
          ),
        isPanelVariant() &&
          cn(
            'gap-0.5 border-0 bg-transparent pr-1 shadow-none outline-none',
            interactionDisabled() && 'pointer-events-none opacity-50'
          )
      )}
    >
      <button
        onClick={handleClick}
        disabled={interactionDisabled()}
        class={cn(
          'relative isolate z-0',
          defaultVariant() &&
            cn(
              callControlPressable,
              callControlDefaultSize,
              callControlPanelFlat,
              "before:pointer-events-none before:absolute before:right-0 before:top-2 before:bottom-2 before:h-auto before:w-[1px] before:bg-ink-extra-muted/40 before:content-['']",
              '-translate-x-[3px]',
              !props.danger &&
                defaultActive() &&
                cn('before:bg-accent-2', callControlPanelActive),
              !props.danger && !defaultActive() && callControlPanelIdle,
              props.danger && callControlPanelDanger
            ),
          isPanelVariant() &&
            cn(
              callControlPressable,
              'h-8 w-5 rounded-md',
              callControlPanelFlat,
              panelChrome()
            )
        )}
      >
        <span class="relative z-10 flex items-center justify-center">
          {props.children}
        </span>
      </button>

      <DropdownMenu>
        <DropdownMenu.Trigger
          class={cn(
            callControlPressable,
            defaultVariant() &&
              cn(
                !props.danger &&
                  defaultActive() &&
                  callControlPanelActive,
                !props.danger && !defaultActive() && callControlPanelIdle,
                props.danger && callControlPanelDanger
              ),
            isPanelVariant() && panelChrome()
          )}
        >
          <CaretDown
            class={
              isPanelVariant()
                ? 'w-2.5 h-2.5 shrink-0'
                : 'w-3 h-3 shrink-0'
            }
          />
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenuContent class="mb-2" width="lg">
            {props.dropdownContent()}
          </DropdownMenuContent>
        </DropdownMenu.Portal>
      </DropdownMenu>
    </div>
  );
}
