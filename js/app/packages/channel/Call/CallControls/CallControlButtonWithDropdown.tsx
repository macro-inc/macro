import { DropdownMenu } from '@kobalte/core/dropdown-menu';
import { DropdownMenuContent } from '@core/component/Menu';
import CaretDown from '@icon/regular/caret-down.svg';
import { createMemo, type JSX } from 'solid-js';
import { cn } from '@ui/utils/classname';
import {
  callControlButtonStyles,
  type CallControlButtonSize,
} from './CallControlButton';

export function CallControlButtonWithDropdown(props: {
  onClick: () => Promise<void> | void;
  active?: boolean;
  danger?: boolean;
  children?: JSX.Element;
  dropdownContent: () => JSX.Element;
  disabled?: boolean;
  size?: CallControlButtonSize;
}) {
  const interactionDisabled = createMemo(() => !!props.disabled);

  const handleClick = () => {
    if (interactionDisabled()) return;
    props.onClick();
  };

  const size = () => props.size ?? 'default';
  const isDefault = () => size() === 'default';
  const isPanel = () => size() === 'panel';

  const variantClass = () => {
    const sizeVariant = callControlButtonStyles.variant[size()];
    if (props.danger) return sizeVariant.danger;
    if (props.active) return sizeVariant.active;
    return sizeVariant.base;
  };

  const panelVariantKey = () =>
    props.danger ? 'danger' : props.active ? 'active' : 'base';

  return (
    <div
      class={cn(
        'isolate flex items-center transition-colors',
        isDefault() &&
          cn(
            'rounded-lg gap-1 pr-2',
            variantClass(),
            interactionDisabled() && 'pointer-events-none opacity-50'
          ),
        isPanel() &&
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
          isDefault() &&
            cn(
              callControlButtonStyles.base,
              callControlButtonStyles.size.default,
              'border-0 bg-transparent shadow-none',
              "before:pointer-events-none before:absolute before:right-0 before:top-2 before:bottom-2 before:h-auto before:w-[1px] before:bg-ink-extra-muted/40 before:content-['']",
              '-translate-x-[3px]',
              props.active && 'before:bg-success',
              callControlButtonStyles.variant.panel[panelVariantKey()]
            ),
          isPanel() &&
            cn(
              callControlButtonStyles.base,
              'h-8 w-5 rounded-md border-0 bg-transparent shadow-none',
              variantClass()
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
            callControlButtonStyles.base,
            callControlButtonStyles.variant.panel[panelVariantKey()]
          )}
        >
          <CaretDown
            class={isPanel() ? 'w-2.5 h-2.5 shrink-0' : 'w-3 h-3 shrink-0'}
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
