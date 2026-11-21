import { t } from '@app/lib/i18n';
import { MobileDrawer } from '@components/app/mobile/MobileDrawer';
import { type EntityData, InlineEntity } from '@entity';
import {
  type NotificationMuteMenuProps,
  NotificationMutePage,
} from '@notifications/components/NotificationMuteMenu';
import {
  type NotificationSettingsMenuProps,
  NotificationSettingsPage,
  NotificationSettingsSummary,
} from '@notifications/components/NotificationSettingsMenu';
import { CopyButton, cn } from '@ui';
import { type Component, createSignal, For, type JSX, Show } from 'solid-js';
import { Dynamic } from 'solid-js/web';

export type SoupEntityDrawerAction = {
  id: string;
  label: string;
  destructive?: boolean;
  disabled?: boolean;
  onClick: () => void | Promise<unknown>;
  copy?: boolean;
  icon?: Component<JSX.SvgSVGAttributes<SVGSVGElement>>;
  muteMenu?: NotificationMuteMenuProps;
  notificationSettingsMenu?: NotificationSettingsMenuProps;
};

export type SoupEntityDrawerActionGroup = {
  items: readonly SoupEntityDrawerAction[];
};

type SoupEntityActionDrawerProps = {
  entity: EntityData | undefined;
  groups: readonly SoupEntityDrawerActionGroup[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Host content above the actions, such as a detail's view choices. */
  leading?: JSX.Element;
  beforeAction?: (
    action: SoupEntityDrawerAction,
    trigger: HTMLButtonElement
  ) => void;
};

/** Mobile drawer presentation shared by Soup-backed entity lists. */
export function SoupEntityActionDrawer(props: SoupEntityActionDrawerProps) {
  // The action whose choices replace the list: a mute or settings drill-in.
  const [pageActionId, setPageActionId] = createSignal<string>();
  const pageAction = () =>
    props.groups
      .flatMap((group) => group.items)
      .find((action) => action.id === pageActionId());
  const muteMenu = () => pageAction()?.muteMenu;
  const settingsMenu = () => pageAction()?.notificationSettingsMenu;
  const close = () => {
    setPageActionId(undefined);
    props.onOpenChange(false);
  };
  return (
    <MobileDrawer
      side="bottom"
      open={props.open}
      closeOnOutsidePointerStrategy="pointerdown"
      onOpenChange={(open) => {
        if (!open) setPageActionId(undefined);
        props.onOpenChange(open);
      }}
      preventScroll={false}
      preventScrollbarShift={false}
      restoreFocus={false}
      noOutsidePointerEvents={false}
    >
      <MobileDrawer.Portal>
        <MobileDrawer.Overlay />
        <MobileDrawer.Content aria-label={t('entityActions.entityActions')}>
          <MobileDrawer.Handle />

          <Show when={props.entity}>
            {(entity) => (
              <div class="px-4 pb-4 shrink-0 text-sm font-medium text-ink-muted">
                <InlineEntity entity={entity()} />
              </div>
            )}
          </Show>

          <MobileDrawer.ScrollBody>
            <Show
              when={pageAction()}
              fallback={
                <>
                  {props.leading}
                  <For each={props.groups}>
                    {(group, groupIndex) => (
                      <>
                        <Show when={groupIndex() > 0}>
                          <div class="mt-3" />
                        </Show>
                        <MobileDrawer.Section class="flex flex-col shrink-0">
                          <For each={group.items}>
                            {(action) => (
                              <Show
                                when={!action.copy}
                                fallback={
                                  <CopyButton
                                    as={MobileDrawer.Item}
                                    disabled={action.disabled}
                                    onClick={() => action.onClick()}
                                    icon={
                                      <Show when={action.icon}>
                                        {(icon) => (
                                          <Dynamic
                                            component={icon()}
                                            class="size-4 shrink-0"
                                          />
                                        )}
                                      </Show>
                                    }
                                  >
                                    {action.label}
                                  </CopyButton>
                                }
                              >
                                <MobileDrawer.Item
                                  type="button"
                                  disabled={
                                    action.disabled || action.muteMenu?.disabled
                                  }
                                  class={cn(
                                    action.destructive
                                      ? 'text-failure-ink'
                                      : 'text-ink',
                                    action.disabled && 'opacity-50'
                                  )}
                                  onClick={async (event) => {
                                    if (action.notificationSettingsMenu) {
                                      setPageActionId(action.id);
                                      return;
                                    }
                                    if (action.muteMenu) {
                                      if (action.muteMenu.muted) {
                                        action.muteMenu.onMute(false);
                                        close();
                                      } else setPageActionId(action.id);
                                      return;
                                    }
                                    props.beforeAction?.(
                                      action,
                                      event.currentTarget
                                    );
                                    await action.onClick();
                                    close();
                                  }}
                                >
                                  <Show when={action.icon}>
                                    {(icon) => (
                                      <Dynamic
                                        component={icon()}
                                        class="size-4 shrink-0"
                                      />
                                    )}
                                  </Show>
                                  {action.label}
                                  <Show when={action.notificationSettingsMenu}>
                                    {(menu) => (
                                      <NotificationSettingsSummary
                                        preset={menu().preset}
                                      />
                                    )}
                                  </Show>
                                </MobileDrawer.Item>
                              </Show>
                            )}
                          </For>
                        </MobileDrawer.Section>
                      </>
                    )}
                  </For>
                </>
              }
            >
              <Show
                when={settingsMenu()}
                fallback={
                  <Show when={muteMenu()}>
                    {(menu) => (
                      <NotificationMutePage
                        {...menu()}
                        onBack={() => setPageActionId(undefined)}
                        onActionComplete={close}
                      />
                    )}
                  </Show>
                }
              >
                {(menu) => (
                  <NotificationSettingsPage
                    {...menu()}
                    onBack={() => setPageActionId(undefined)}
                    onActionComplete={close}
                  />
                )}
              </Show>
            </Show>
          </MobileDrawer.ScrollBody>
        </MobileDrawer.Content>
      </MobileDrawer.Portal>
    </MobileDrawer>
  );
}
