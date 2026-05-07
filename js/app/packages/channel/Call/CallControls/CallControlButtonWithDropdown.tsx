import { DropdownMenu } from '@kobalte/core/dropdown-menu';
import { DropdownMenuContent } from '@core/component/Menu';
import CaretDown from '@icon/regular/caret-down.svg';
import { createMemo, Show, type JSX } from 'solid-js';
import { cn } from '@ui';
import {
  CallControlButton,
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

  const size = () => props.size ?? 'md';
  const isMd = () => size() === 'md';
  const isSm = () => size() === 'sm';

  return (
    <div
      class={cn(
        'isolate flex items-center transition-colors',
        isMd() &&
          cn(
            'rounded-lg p-1 gap-1 outline outline-edge-muted',
            props.active && callControlButtonStyles.variant.active,
            interactionDisabled() && 'pointer-events-none opacity-50'
          ),
        isSm() &&
          cn(
            'bg-transparent p-0.5 shadow-none outline-none',
            interactionDisabled() && 'pointer-events-none opacity-50'
          )
      )}
    >
      <CallControlButton
        onClick={handleClick}
        disabled={interactionDisabled()}
        active={props.active}
        danger={props.danger}
        size={props.size}
        class={cn('outline-0 bg-transparent', isMd() && 'h-8')}
      >
        {props.children}
      </CallControlButton>

      <Show when={!isSm()}>
        <div class="w-px h-8 bg-ink/20 pointer-events-none" />
      </Show>

      <DropdownMenu>
        <DropdownMenu.Trigger
          as={CallControlButton}
          active={props.active}
          danger={props.danger}
          size={props.size}
          class={cn(
            'outline-0 bg-transparent w-auto px-1 rounded-md',
            isMd() && 'h-8'
          )}
        >
          <CaretDown
            class={isSm() ? 'w-2.5 h-2.5 shrink-0' : 'w-3 h-3 shrink-0'}
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
