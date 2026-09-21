import { CREATE_MENU_COMMAND_SCOPE } from '@app/constants/hotkeys';
import { useHotkeyInterceptor } from '@app/signal/hotkeyRoot';
import { setActiveScope } from '@core/hotkey/state';
import { activateClosestDOMScope } from '@core/hotkey/utils';
import { createSignal } from 'solid-js';
import { CalendarCreateMenu } from '../components/calendar-create-menu';

export function CalendarCreateMenuView(props: {
  pending: boolean;
  onEvent: () => void;
  onQuickCall: () => void;
}) {
  const [open, setOpen] = createSignal(false);
  function changeOpen(next: boolean) {
    setOpen(next);
    if (next) setActiveScope(CREATE_MENU_COMMAND_SCOPE);
    else activateClosestDOMScope();
  }
  function select(action: () => void) {
    if (props.pending) return;
    changeOpen(false);
    action();
  }
  useHotkeyInterceptor((context) => {
    if (!open() || context.eventType !== 'keydown' || context.isEditableFocused)
      return false;
    if (
      context.pressedKeysString === 'escape' ||
      context.pressedKeysString === 'c'
    ) {
      changeOpen(false);
      return true;
    }
    const actions = {
      e: props.onEvent,
      q: props.onQuickCall,
    };
    const key = context.pressedKeysString;
    if (key !== 'e' && key !== 'q') return false;
    select(actions[key]);
    return true;
  });
  return (
    <CalendarCreateMenu
      open={open()}
      onOpenChange={changeOpen}
      pending={props.pending}
      onEvent={() => select(props.onEvent)}
      onQuickCall={() => select(props.onQuickCall)}
    />
  );
}
