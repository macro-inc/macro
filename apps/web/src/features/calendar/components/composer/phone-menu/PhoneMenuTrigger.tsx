import CaretIcon from '@icon/system/regular/caret-down.svg';
import { Button } from '@ui';
import type { JSX } from 'solid-js';
import { usePhoneComposerMenu } from '../../../context/phone-composer-menu-context';
import type { PhoneMenuId } from '../../../primitives/phone-menu-pattern';

export interface PhoneMenuTriggerProps {
  menu: PhoneMenuId;
  title: string;
  value: JSX.Element;
  icon?: JSX.Element;
  disabled?: boolean;
  placeholder?: boolean;
  onOpen?: () => void;
}
export function PhoneMenuTrigger(props: PhoneMenuTriggerProps) {
  const menus = usePhoneComposerMenu();
  const opened = () =>
    menus.when.state.active === props.menu && !props.disabled;
  return (
    <Button
      variant="row"
      size="sheet-row"
      fullWidth
      class="grid grid-cols-[18px_minmax(0,1fr)_16px] gap-x-3 px-3 text-left font-normal"
      classList={{
        'text-ink-subtle': props.placeholder,
      }}
      aria-label={props.title}
      aria-expanded={opened()}
      disabled={props.disabled}
      onPointerDown={(event) => {
        if (props.menu === 'people' || props.menu === 'time-zone')
          event.preventDefault();
      }}
      onMouseDown={(event) => {
        if (props.menu === 'people' || props.menu === 'time-zone')
          event.preventDefault();
      }}
      onClick={(event) => {
        props.onOpen?.();
        menus.open(props.menu, event.currentTarget);
      }}
    >
      <span class="flex justify-center text-ink-muted">{props.icon}</span>
      <span class="min-w-0 truncate">{props.value}</span>
      <CaretIcon class="size-4 text-ink-subtle" />
    </Button>
  );
}
