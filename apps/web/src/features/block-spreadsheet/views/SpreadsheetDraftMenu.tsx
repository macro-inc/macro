import { MobileDrawer } from '@components/app/mobile/MobileDrawer';
import type { SplitFileMenuActionGroups } from '@components/app/split-layout/context';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import DotsThree from '@phosphor/dots-three.svg';
import Rename from '@phosphor/pencil-line.svg';
import Share from '@phosphor/share.svg';
import Sparkle from '@phosphor/sparkle.svg';
import { Dropdown } from '@ui';
import { createEffect, createMemo, For, on, onCleanup, Show } from 'solid-js';
import { Dynamic } from 'solid-js/web';

export function SpreadsheetDraftMenu(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAsk: () => void;
  onShare: () => void;
  onRename?: () => void;
}) {
  const panel = useSplitPanelOrThrow();
  const groups = createMemo<SplitFileMenuActionGroups>(() => ({
    entity: [],
    sender: [],
    macro: [{ label: 'Ask Macro', icon: Sparkle, action: props.onAsk }],
    sharing: [{ label: 'Share', icon: Share, action: props.onShare }],
    file: props.onRename
      ? [{ label: 'Rename', icon: Rename, action: props.onRename }]
      : [],
    delete: [],
  }));
  const actions = () => [
    ...groups().macro,
    ...groups().sharing,
    ...groups().file,
  ];
  panel.setTitleFileMenuTrigger(() => () => props.onOpenChange(true));
  createEffect(on(groups, (value) => panel.setTitleFileMenuActions(value)));
  onCleanup(() => {
    panel.setTitleFileMenuTrigger(undefined);
    panel.setTitleFileMenuActions(undefined);
  });

  return (
    <Show
      when={isTouchDevice()}
      fallback={
        <Dropdown open={props.open} onOpenChange={props.onOpenChange}>
          <Dropdown.Trigger label="File actions" size="icon-sm" variant="ghost">
            <DotsThree />
          </Dropdown.Trigger>
          <Dropdown.Content class="w-64">
            <Dropdown.Group>
              <For each={actions()}>
                {(action) => (
                  <Dropdown.Item
                    onSelect={() => {
                      action.action?.();
                      props.onOpenChange(false);
                    }}
                  >
                    <span class="size-4 shrink-0 [&>svg]:size-full">
                      <Dynamic component={action.icon} />
                    </span>
                    {action.label}
                  </Dropdown.Item>
                )}
              </For>
            </Dropdown.Group>
          </Dropdown.Content>
        </Dropdown>
      }
    >
      <MobileDrawer
        side="bottom"
        open={props.open}
        onOpenChange={props.onOpenChange}
        preventScroll={false}
        preventScrollbarShift={false}
      >
        <MobileDrawer.Portal>
          <MobileDrawer.Overlay />
          <MobileDrawer.Content aria-label="File actions">
            <MobileDrawer.Handle />
            <MobileDrawer.ScrollBody>
              <MobileDrawer.Section>
                <For each={actions()}>
                  {(action) => (
                    <MobileDrawer.Item
                      type="button"
                      onClick={() => {
                        action.action?.();
                        props.onOpenChange(false);
                      }}
                    >
                      <span class="size-4 shrink-0 [&>svg]:size-full">
                        <Dynamic component={action.icon} />
                      </span>
                      {action.label}
                    </MobileDrawer.Item>
                  )}
                </For>
              </MobileDrawer.Section>
            </MobileDrawer.ScrollBody>
          </MobileDrawer.Content>
        </MobileDrawer.Portal>
      </MobileDrawer>
    </Show>
  );
}
