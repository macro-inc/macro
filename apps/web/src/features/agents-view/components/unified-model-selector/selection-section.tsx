import { MobileDrawer } from '@components/app/mobile/MobileDrawer';
import { Menu } from '@ui';
import { type JSX, Show } from 'solid-js';
import { Dynamic } from 'solid-js/web';

/** Every selector section uses the app's normal menu group and label. */
export function ModelSelectionSection(props: {
  title?: string;
  action?: JSX.Element;
  mobile?: boolean;
  children: JSX.Element;
}) {
  return (
    <Dynamic
      component={props.mobile ? MobileDrawer.Section : Menu.Group}
      role="group"
      aria-label={props.title}
    >
      <Show when={props.title}>
        <Dynamic
          component={props.mobile ? MobileDrawer.Label : Menu.Label}
          class="flex items-center justify-between gap-2"
        >
          <span>{props.title}</span>
          {props.action}
        </Dynamic>
      </Show>
      {props.children}
    </Dynamic>
  );
}
