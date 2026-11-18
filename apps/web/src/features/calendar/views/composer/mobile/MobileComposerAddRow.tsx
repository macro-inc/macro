import PlusIcon from '@icon/system/regular/plus.svg';
import { Button } from '@ui';
import type { JSX } from 'solid-js';

export function MobileComposerAddRow(props: {
  label: string;
  icon: JSX.Element;
  disabled: boolean;
  onClick: (element: HTMLButtonElement) => void;
}) {
  return (
    <Button
      variant="ghost"
      size="sheet-row"
      fullWidth
      class="grid grid-cols-[18px_minmax(0,1fr)_16px] gap-3 px-3 text-left"
      disabled={props.disabled}
      onClick={(event) => props.onClick(event.currentTarget)}
    >
      <span aria-hidden="true" class="flex justify-center">
        {props.icon}
      </span>
      <span class="text-ink-subtle">{props.label}</span>
      <PlusIcon class="size-4 shrink-0" />
    </Button>
  );
}
