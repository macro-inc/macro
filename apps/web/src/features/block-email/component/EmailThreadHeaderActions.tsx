import type { EmailThreadListNavigation } from '@app/features/email-thread/context/email-thread-context';
import { HeaderActionGroup } from '@components/app/HeaderActionGroup';
import { SidePanel } from '@components/app/side-panel';
import { ListNavigationButtons } from '@components/app/split-layout/components/SplitHeader';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { type ComponentProps, type JSX, Show } from 'solid-js';
import { EmailThreadControls } from './EmailThreadControls';

export function EmailThreadControlGroups(props: {
  controls: ComponentProps<typeof EmailThreadControls>;
  navigation?: EmailThreadListNavigation;
}) {
  return (
    <div class="flex items-center gap-2 touch:hidden">
      <HeaderActionGroup label="Email actions" size="md">
        <EmailThreadControls grouped {...props.controls} />
      </HeaderActionGroup>
      <Show when={props.navigation}>
        {(navigation) => (
          <HeaderActionGroup label="Item navigation" size="md">
            <ListNavigationButtons
              navigation={navigation()}
              size="md"
              class="gap-0"
            />
          </HeaderActionGroup>
        )}
      </Show>
    </div>
  );
}

/** The same desktop action groups in Mail and inline thread previews. */
export function EmailThreadHeaderActions(props: {
  controls?: JSX.Element;
  share?: JSX.Element;
}) {
  return (
    <div class="ml-auto flex shrink-0 items-center gap-2 touch:gap-1">
      {props.controls}
      <SidePanel.HeaderActionsOutlet />
      <Show when={props.share}>
        <Show when={!isTouchDevice()} fallback={props.share}>
          <HeaderActionGroup label="Sharing" size="md">
            {props.share}
          </HeaderActionGroup>
        </Show>
      </Show>
      <SidePanel.Toggle size="md" />
    </div>
  );
}
