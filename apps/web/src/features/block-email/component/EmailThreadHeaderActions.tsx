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
      <HeaderActionGroup label="Email actions">
        <EmailThreadControls {...props.controls} />
      </HeaderActionGroup>
      <Show when={props.navigation}>
        {(navigation) => (
          <HeaderActionGroup label="Item navigation">
            <ListNavigationButtons navigation={navigation()} class="gap-0" />
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
    <div class="ml-auto flex shrink-0 items-center gap-2 touch:gap-1 @max-[900px]/split-header:[&_[data-header-action]]:w-8 @max-[900px]/split-header:[&_[data-header-action]]:p-0 @max-[900px]/split-header:[&_[data-header-action-label]]:hidden">
      {props.controls}
      <Show
        when={!isTouchDevice()}
        fallback={<SidePanel.HeaderActionsOutlet />}
      >
        <HeaderActionGroup
          label="Actions"
          class="has-[[data-side-panel-header-actions]:empty]:hidden [&_[data-header-action]]:size-8 [&_[data-header-action]]:p-0 [&_[data-header-action-label]]:hidden"
        >
          <SidePanel.HeaderActionsOutlet />
        </HeaderActionGroup>
      </Show>
      <Show when={props.share}>
        <Show when={!isTouchDevice()} fallback={props.share}>
          <HeaderActionGroup
            label="Sharing"
            class="[&_[data-header-action]]:w-auto! [&_[data-header-action]]:px-3! [&_[data-header-action-label]]:inline!"
          >
            {props.share}
          </HeaderActionGroup>
        </Show>
      </Show>
      <SidePanel.Toggle />
    </div>
  );
}
