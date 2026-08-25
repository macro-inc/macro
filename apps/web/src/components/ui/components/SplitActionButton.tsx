import CaretDownIcon from '@phosphor/caret-down.svg';
import type { JSX, ParentProps } from 'solid-js';
import { cn } from '../utils/classname';
import { Button, type ButtonVariant } from './Button';
import { ButtonGroup } from './ButtonGroup';
import { Dropdown } from './Dropdown';

export type SplitActionButtonProps = ParentProps<{
  label: string;
  icon?: JSX.Element;
  onPrimaryAction: () => void;
  variant?: ButtonVariant;
  class?: string;
}>;

/** A primary action paired with a compact dropdown trigger. */
export function SplitActionButton(props: SplitActionButtonProps) {
  const variant = () => props.variant ?? 'cta';

  return (
    <Dropdown placement="bottom-start">
      <ButtonGroup
        variant={variant()}
        class={cn('h-8 rounded-full', props.class)}
      >
        <Button
          variant={variant()}
          size="sm"
          class="h-8 gap-1.5 !border-0 px-3 font-semibold"
          onClick={props.onPrimaryAction}
        >
          {props.icon}
          <span>{props.label}</span>
        </Button>
        <ButtonGroup.Divider short class="bg-surface/25" />
        <Dropdown.Trigger
          variant={variant()}
          size="sm"
          class="h-8 min-w-8 !border-0 px-2"
          aria-label={`More ${props.label} options`}
        >
          <CaretDownIcon class="size-3" />
        </Dropdown.Trigger>
      </ButtonGroup>
      <Dropdown.Content>
        <Dropdown.Group>{props.children}</Dropdown.Group>
      </Dropdown.Content>
    </Dropdown>
  );
}
