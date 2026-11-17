import { SheetRow } from '@components/app/mobile/sheet-row/SheetRow';
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
    <SheetRow icon={props.icon}>
      <Button
        variant="ghost"
        size="sheet"
        fullWidth
        class="justify-between"
        disabled={props.disabled}
        onClick={(event) => props.onClick(event.currentTarget)}
      >
        {props.label}
        <PlusIcon class="size-4 shrink-0" />
      </Button>
    </SheetRow>
  );
}
