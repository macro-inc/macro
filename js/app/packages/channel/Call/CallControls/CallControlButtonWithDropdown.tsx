import { DropdownMenu } from '@kobalte/core/dropdown-menu';
import { DropdownMenuContent } from '@core/component/Menu';
import CaretDown from '@icon/regular/caret-down.svg';
import { createMemo, createSignal, type JSX } from 'solid-js';
import { cn } from '@ui/utils/classname';
import type { CallControlVariant } from './CallControlButton';

/**
 * Call control with a chevron that opens device selection (mic / camera).
 */
export function CallControlButtonWithDropdown(props: {
  onClick: () => Promise<void> | void;
  active?: boolean;
  children?: JSX.Element;
  /** Render prop: menu content must be created under this `DropdownMenu` root. */
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
  const isPanelVariant = () => {
    const v = resolvedVariant();
    return v === 'panel' || v === 'panel-small';
  };

  return (
    <div
      class={cn(
        'isolate flex items-center transition-colors',
        resolvedVariant() === 'default' &&
          'before:pointer-events-none outline-1 outline-task/50 rounded-lg gap-1 pr-2',
        isPanelVariant() &&
          'gap-0.5 border-0 bg-transparent pr-1 outline-none shadow-none hover:bg-hover',
        resolvedVariant() === 'default' && props.active && 'bg-task/30',
        interactionDisabled() && 'opacity-50 pointer-events-none',
        resolvedVariant() === 'default' &&
          !interactionDisabled() &&
          'text-ink hover:bg-task/40',
        isPanelVariant() &&
          !interactionDisabled() &&
          !props.active &&
          'text-ink',
        isPanelVariant() &&
          !interactionDisabled() &&
          props.active &&
          'text-accent-2'
      )}
    >
      <button
        onClick={handleClick}
        disabled={interactionDisabled()}
        class={cn(
          'relative isolate z-0 flex items-center justify-center transition-colors cursor-pointer',
          resolvedVariant() === 'default' &&
            `before:pointer-events-none before:absolute before:right-0 before:top-2 before:bottom-2 before:h-auto before:w-[2px] before:bg-task/30 before:content-[''] w-10 h-10 -translate-x-[3px] rounded-lg`,
          isPanelVariant() &&
            'w-5 h-8 rounded-md border-0 bg-transparent shadow-none'
        )}
      >
        <span class="relative z-10 flex items-center justify-center">
          {props.children}
        </span>
      </button>

      <DropdownMenu>
        <DropdownMenu.Trigger class="cursor-pointer flex items-center justify-center text-inherit">
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
