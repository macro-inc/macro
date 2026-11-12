import { t } from '@app/lib/i18n';
import { MobileDrawer } from '@components/app/mobile/MobileDrawer';
import { type EntityData, InlineEntity } from '@entity';
import {
  type NotificationMuteMenuProps,
  NotificationMutePage,
} from '@notifications/components/NotificationMuteMenu';
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
};

export type SoupEntityDrawerActionGroup = {
  items: readonly SoupEntityDrawerAction[];
};

type SoupEntityActionDrawerProps = {
  entity: EntityData | undefined;
  groups: readonly SoupEntityDrawerActionGroup[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  beforeAction?: (
    action: SoupEntityDrawerAction,
    trigger: HTMLButtonElement
  ) => void;
};

/** Mobile drawer presentation shared by Soup-backed entity lists. */
export function SoupEntityActionDrawer(props: SoupEntityActionDrawerProps) {
  const [muteActionId, setMuteActionId] = createSignal<string>();
  const muteMenu = () =>
    props.groups
      .flatMap((group) => group.items)
      .find((action) => action.id === muteActionId())?.muteMenu;
  const close = () => {
    setMuteActionId(undefined);
    props.onOpenChange(false);
  };
  return (
    <MobileDrawer
      side="bottom"
      open={props.open}
      closeOnOutsidePointerStrategy="pointerdown"
      onOpenChange={(open) => {
        if (!open) setMuteActionId(undefined);
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
              when={muteMenu()}
              fallback={
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
                                  if (action.muteMenu) {
                                    if (action.muteMenu.muted) {
                                      action.muteMenu.onMute(false);
                                      close();
                                    } else setMuteActionId(action.id);
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
                              </MobileDrawer.Item>
                            </Show>
                          )}
                        </For>
                      </MobileDrawer.Section>
                    </>
                  )}
                </For>
              }
            >
              {(menu) => (
                <NotificationMutePage
                  {...menu()}
                  onBack={() => setMuteActionId(undefined)}
                  onActionComplete={close}
                />
              )}
            </Show>
          </MobileDrawer.ScrollBody>
        </MobileDrawer.Content>
      </MobileDrawer.Portal>
    </MobileDrawer>
  );
}
