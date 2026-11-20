import { MobileDrawer } from '@components/app/mobile/MobileDrawer';
import { isMobile } from '@core/mobile/isMobile';
import { type ButtonProps, Dropdown } from '@ui';
import { type Component, type JSX, Show } from 'solid-js';
import { Dynamic } from 'solid-js/web';

/** Call settings use anchored desktop menus and the shared phone drawer. */
export function CallSettingsMenu(props: {
  title: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trigger: Component<ButtonProps>;
  children: JSX.Element;
  mobileContent: JSX.Element;
}) {
  return (
    <Show
      when={isMobile()}
      fallback={
        <Dropdown
          placement="top-start"
          open={props.open}
          onOpenChange={props.onOpenChange}
        >
          <Dropdown.Trigger as={props.trigger} />
          <Dropdown.Content
            portalScope="local"
            class="w-80 max-w-[calc(100vw-2rem)]"
          >
            {props.children}
          </Dropdown.Content>
        </Dropdown>
      }
    >
      <MobileDrawer
        open={props.open}
        onOpenChange={props.onOpenChange}
        restoreFocus
        noOutsidePointerEvents
      >
        <Dynamic
          component={props.trigger}
          aria-haspopup="dialog"
          aria-expanded={props.open}
          onClick={() => props.onOpenChange(!props.open)}
        />
        <MobileDrawer.Portal>
          <MobileDrawer.Overlay />
          <MobileDrawer.Content>
            <MobileDrawer.Handle />
            <MobileDrawer.Title class="px-6 pb-3 text-sm font-medium">
              {props.title}
            </MobileDrawer.Title>
            <MobileDrawer.ScrollBody>
              {props.mobileContent}
            </MobileDrawer.ScrollBody>
          </MobileDrawer.Content>
        </MobileDrawer.Portal>
      </MobileDrawer>
    </Show>
  );
}
