import { type ParentProps, Show } from 'solid-js';
import { usePhoneComposerMenu } from '../../../context/phone-composer-menu-context';
import { PhoneMenuPage } from './PhoneMenuPage';
import {
  PhoneMenuTrigger,
  type PhoneMenuTriggerProps,
} from './PhoneMenuTrigger';

export function PhoneMenu(
  props: ParentProps<PhoneMenuTriggerProps & { done?: () => void }>
) {
  const menus = usePhoneComposerMenu();
  const opened = () =>
    menus.when.state.active === props.menu && !props.disabled;
  const page = () => menus.pattern(props.menu) === 'page';
  return (
    <>
      <PhoneMenuTrigger {...props} />
      <Show when={opened()}>
        <Show
          when={page()}
          fallback={<div class="pb-2 pl-[42px] pr-3">{props.children}</div>}
        >
          <PhoneMenuPage title={props.title} done={props.done}>
            {props.children}
          </PhoneMenuPage>
        </Show>
      </Show>
    </>
  );
}
