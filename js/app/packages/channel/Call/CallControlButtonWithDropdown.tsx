import { DropdownMenu } from '@kobalte/core/dropdown-menu';
import { DropdownMenuContent } from '@core/component/Menu';
import CaretDown from '@icon/regular/caret-down.svg';
import { createSignal, type JSX } from 'solid-js';
import { cn } from '@ui/utils/classname';
import type { CallControlVariant } from './CallControlButton';

/**
 * Call control with a chevron that opens device selection (mic / camera).
 */
export function CallControlButtonWithDropdown(incoming: {
  onClick: () => Promise<void> | void;
  active?: boolean;
  children?: JSX.Element;
  /** Render prop: menu content must be created under this `DropdownMenu` root. */
  dropdownContent: () => JSX.Element;
  disabled?: boolean;
  variant?: CallControlVariant;
}) {
  const {
    onClick,
    active,
    children,
    dropdownContent,
    disabled: disabledProp,
    variant: variantProp,
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
    <div
      class={cn(
        'isolate flex items-center transition-colors',
        resolvedVariant === 'default' &&
          'before:pointer-events-none outline-1 outline-task/30 rounded-lg gap-1 pr-2',
        resolvedVariant === 'panel' &&
          'gap-0.5 border-0 bg-transparent pr-1 outline-none shadow-none',
        resolvedVariant === 'default' && active && 'bg-task/15',
        interactionDisabled && 'opacity-50 pointer-events-none',
        resolvedVariant === 'default' &&
          !interactionDisabled &&
          'text-ink hover:bg-task/40',
        resolvedVariant === 'panel' &&
          !interactionDisabled &&
          !active &&
          'text-ink',
        resolvedVariant === 'panel' &&
          !interactionDisabled &&
          active &&
          'text-accent-2'
      )}
    >
      <button
        onClick={handleClick}
        disabled={interactionDisabled}
        class={cn(
          'relative isolate z-0 flex items-center justify-center transition-colors cursor-pointer',
          resolvedVariant === 'default' &&
            `before:pointer-events-none before:absolute before:right-0 before:top-2 before:bottom-2 before:h-auto before:w-[2px] before:bg-task/30 before:content-[''] w-10 h-10 -translate-x-[3px] rounded-lg`,
          resolvedVariant === 'panel' &&
            'w-5 h-5 rounded-md border-0 bg-transparent shadow-none'
        )}
      >
        <span class="relative z-10 flex items-center justify-center">
          {children}
        </span>
      </button>

      <DropdownMenu>
        <DropdownMenu.Trigger class="cursor-pointer flex items-center justify-center text-inherit">
          <CaretDown
            class={
              resolvedVariant === 'panel'
                ? 'w-2.5 h-2.5 shrink-0'
                : 'w-3 h-3 shrink-0'
            }
          />
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenuContent class="mb-2" width="lg">
            {dropdownContent()}
          </DropdownMenuContent>
        </DropdownMenu.Portal>
      </DropdownMenu>
    </div>
  );
}
