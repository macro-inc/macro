import { t } from '@app/lib/i18n';
import { MobileDrawer } from '@components/app/mobile/MobileDrawer';
import { fireAndForget } from '@core/util/fireAndForget';
import BellSimple from '@icon/system/regular/bell-simple.svg';
import BellSlash from '@icon/system/regular/bell-slash.svg';
import CaretDown from '@icon/system/regular/caret-down.svg';
import CaretRight from '@icon/system/regular/caret-right.svg';
import Check from '@icon/system/regular/check.svg';
import Copy from '@icon/system/regular/copy.svg';
import DotsThree from '@icon/system/regular/dots-three.svg';
import {
  NotificationMuteMenu,
  NotificationMutePage,
} from '@notifications/components/NotificationMuteMenu';
import {
  NotificationSettingsMenu,
  NotificationSettingsPage,
  NotificationSettingsSummary,
} from '@notifications/components/NotificationSettingsMenu';
import { Key } from '@solid-primitives/keyed';
import { CopyButton, cn, Dropdown, Hotkey } from '@ui';
import {
  type Component,
  createSignal,
  For,
  type JSX,
  Match,
  Show,
  Switch,
} from 'solid-js';
import { Dynamic } from 'solid-js/web';
import {
  getSplitFileMenuActionSections,
  type SplitFileMenuAction,
  type SplitFileMenuActionGroups,
} from '../context';
import type { SplitFileMenuViews } from './SplitFileMenu';

function SplitMenuItemContent(
  props: Pick<
    SplitFileMenuAction,
    'hotkeyToken' | 'icon' | 'label' | 'disabledReason'
  > & {
    showHotkey?: boolean;
  }
) {
  return (
    <>
      <Show when={props.icon}>
        {(icon) => (
          <Dynamic
            component={icon() as Component<JSX.SvgSVGAttributes<SVGSVGElement>>}
            class="size-4 shrink-0"
          />
        )}
      </Show>
      <div class="min-w-0 flex-1">
        <div class="truncate">{props.label}</div>
        <Show when={props.disabledReason}>
          <div class="whitespace-normal text-xs text-ink-muted">
            {props.disabledReason}
          </div>
        </Show>
      </div>
      <Show when={props.showHotkey !== false && props.hotkeyToken}>
        <Hotkey
          token={props.hotkeyToken}
          class="ml-4 shrink-0"
          theme="subtle"
          showPlus
        />
      </Show>
    </>
  );
}

type SplitFileMenuRenderProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  triggerClass?: string;
  triggerLabel?: string;
  groups: SplitFileMenuActionGroups;
};

export function DesktopFileMenu(props: SplitFileMenuRenderProps) {
  const sections = () => getSplitFileMenuActionSections(props.groups);

  const item = (action: () => SplitFileMenuAction) => {
    const children = () => action().children?.filter(Boolean) ?? [];
    const content = () => (
      <SplitMenuItemContent
        label={action().label}
        icon={action().icon}
        hotkeyToken={action().hotkeyToken}
      />
    );
    return (
      <Switch>
        <Match when={action().menuItem}>
          {(component) => (
            <Dynamic
              component={component()}
              menu="dropdown"
              onActionComplete={() => props.onOpenChange(false)}
            />
          )}
        </Match>
        <Match when={action().muteMenu}>
          {(menu) => (
            <NotificationMuteMenu
              {...menu()}
              menu="dropdown"
              onActionComplete={() => props.onOpenChange(false)}
            />
          )}
        </Match>
        <Match when={action().notificationSettingsMenu}>
          {(menu) => (
            <NotificationSettingsMenu
              {...menu()}
              onActionComplete={() => props.onOpenChange(false)}
            />
          )}
        </Match>
        <Match when={action().copy}>
          <Dropdown.CopyItem
            icon={<Dynamic component={action().icon ?? Copy} class="size-4" />}
            onCopy={async () => (await action().action?.()) !== false}
          >
            <SplitMenuItemContent
              label={action().label}
              hotkeyToken={action().hotkeyToken}
            />
          </Dropdown.CopyItem>
        </Match>
        <Match when={children().length > 0}>
          <Dropdown.Sub>
            <Dropdown.SubTrigger>
              {content()}
              <CaretRight class="size-3.5 shrink-0" />
            </Dropdown.SubTrigger>
            <Dropdown.SubContent>
              <Dropdown.Group>
                <Key each={children()} by={(child) => child.id ?? child.label}>
                  {item}
                </Key>
              </Dropdown.Group>
            </Dropdown.SubContent>
          </Dropdown.Sub>
        </Match>
        <Match when={true}>
          <Dropdown.Item
            disabledReason={action().disabledReason}
            class={action().group === 'delete' ? 'text-failure-ink' : undefined}
            onSelect={() => {
              fireAndForget(action().action?.(), 'split-file-menu');
              props.onOpenChange(false);
            }}
          >
            {content()}
          </Dropdown.Item>
        </Match>
      </Switch>
    );
  };

  return (
    <Dropdown open={props.open} onOpenChange={props.onOpenChange}>
      <Dropdown.Trigger
        class={cn(props.triggerClass)}
        aria-label={props.triggerLabel ?? t('splitMenu.fileActions')}
        size="icon-sm"
        variant="ghost"
      >
        <DotsThree class="size-3.5 touch:size-6 shrink-0 pointer-events-none" />
      </Dropdown.Trigger>
      <Dropdown.Content class="min-w-64 max-w-[min(22rem,calc(100vw-1rem))]">
        <Key each={sections()} by="key">
          {(section) => (
            <Dropdown.Group>
              <Key
                each={section().actions}
                by={(action) => action.id ?? action.label}
              >
                {item}
              </Key>
            </Dropdown.Group>
          )}
        </Key>
      </Dropdown.Content>
    </Dropdown>
  );
}

export function MobileFileMenu(
  props: SplitFileMenuRenderProps & { views?: SplitFileMenuViews }
) {
  const [expandedSubmenu, setExpandedSubmenu] = createSignal<string | number>();
  const sections = () => getSplitFileMenuActionSections(props.groups);
  const [page, setPage] = createSignal<'mute' | 'settings'>();
  const actions = () => sections().flatMap((section) => section.actions);
  const muteMenu = () =>
    page() === 'mute'
      ? actions().find((action) => action.muteMenu)?.muteMenu
      : undefined;
  const settingsMenu = () =>
    page() === 'settings'
      ? actions().find((action) => action.notificationSettingsMenu)
          ?.notificationSettingsMenu
      : undefined;
  const close = () => {
    setPage(undefined);
    props.onOpenChange(false);
  };

  const item = (
    action: () => SplitFileMenuAction,
    nested = false,
    key: string | number = action().id ?? 0
  ) => {
    if (action().muteMenu) {
      return (
        <MobileDrawer.Item
          disabled={action().muteMenu?.disabled}
          onClick={() => {
            if (action().muteMenu?.muted) {
              action().muteMenu?.onMute(false);
              close();
            } else setPage('mute');
          }}
        >
          <Dynamic
            component={action().muteMenu?.muted ? BellSimple : BellSlash}
            class="size-4 shrink-0"
          />
          <span class="min-w-0 flex-1 truncate">
            {action().muteMenu?.muted
              ? action().muteMenu?.unmuteLabel
              : action().muteMenu?.label}
          </span>
          <Show when={!action().muteMenu?.muted}>
            <CaretRight class="size-3.5" />
          </Show>
        </MobileDrawer.Item>
      );
    }
    if (action().notificationSettingsMenu) {
      return (
        <MobileDrawer.Item
          disabled={action().notificationSettingsMenu?.disabled}
          onClick={() => setPage('settings')}
        >
          <BellSimple class="size-4 shrink-0" />
          <span class="min-w-0 flex-1 truncate">{action().label}</span>
          <Show when={action().notificationSettingsMenu}>
            {(menu) => <NotificationSettingsSummary preset={menu().preset} />}
          </Show>
          <CaretRight class="size-3.5 shrink-0" />
        </MobileDrawer.Item>
      );
    }
    const children = () => action().children?.filter(Boolean) ?? [];
    const expanded = () => expandedSubmenu() === key;

    if (action().copy)
      return (
        <CopyButton
          as={MobileDrawer.Item}
          class={cn(nested ? 'pl-9 pr-4' : 'px-4')}
          onClick={() => action().action?.()}
          icon={<Dynamic component={action().icon ?? Copy} class="size-4" />}
        >
          <SplitMenuItemContent label={action().label} showHotkey={false} />
        </CopyButton>
      );

    return (
      <Show
        when={children().length > 0}
        fallback={
          <MobileDrawer.Item
            type="button"
            disabled={!!action().disabledReason}
            class={cn(
              nested ? 'pl-9 pr-4' : 'px-4',
              (action().danger || action().group === 'delete') &&
                'text-failure-ink'
            )}
            onClick={(e) => {
              fireAndForget(action().action?.(e), 'split-file-menu');
              props.onOpenChange(false);
            }}
          >
            <SplitMenuItemContent
              label={action().label}
              icon={action().icon}
              hotkeyToken={action().hotkeyToken}
              showHotkey={false}
              disabledReason={action().disabledReason}
            />
          </MobileDrawer.Item>
        }
      >
        <div class="w-full">
          <MobileDrawer.Item
            type="button"
            class={cn(nested ? 'pl-9 pr-4' : 'px-4')}
            onClick={() => {
              setExpandedSubmenu(expanded() ? undefined : key);
            }}
          >
            <SplitMenuItemContent
              label={action().label}
              icon={action().icon}
              hotkeyToken={action().hotkeyToken}
              showHotkey={false}
            />
            <Dynamic
              component={expanded() ? CaretDown : CaretRight}
              class="size-3.5 shrink-0"
            />
          </MobileDrawer.Item>
          <Show when={expanded()}>
            <div class="pt-1">
              <For each={children().map((child, index) => child.id ?? index)}>
                {(childKey) =>
                  item(
                    () =>
                      children().find(
                        (child, index) => (child.id ?? index) === childKey
                      )!,
                    true,
                    childKey
                  )
                }
              </For>
            </div>
          </Show>
        </div>
      </Show>
    );
  };

  return (
    <MobileDrawer
      side="bottom"
      open={props.open}
      onOpenChange={(open) => {
        if (!open) setPage(undefined);
        props.onOpenChange(open);
      }}
      preventScroll={false}
      preventScrollbarShift={false}
    >
      <MobileDrawer.Portal>
        <MobileDrawer.Overlay />
        <MobileDrawer.Content aria-label={t('splitMenu.fileActions')}>
          <MobileDrawer.Handle />
          <MobileDrawer.ScrollBody>
            <Show
              when={page()}
              fallback={
                <>
                  <Show when={props.views}>
                    {(views) => (
                      <>
                        <MobileDrawer.Label id="split-file-menu-views-label">
                          {views().title}
                        </MobileDrawer.Label>
                        <MobileDrawer.Section
                          role="radiogroup"
                          aria-labelledby="split-file-menu-views-label"
                          class="flex flex-col shrink-0 mb-3"
                        >
                          <For each={views().options}>
                            {(option) => (
                              <MobileDrawer.Item
                                type="button"
                                role="radio"
                                aria-checked={views().value === option.value}
                                onClick={() => {
                                  views().onSelect(option.value);
                                  props.onOpenChange(false);
                                }}
                              >
                                <SplitMenuItemContent
                                  icon={option.icon}
                                  label={option.label}
                                  showHotkey={false}
                                />
                                <Show when={views().value === option.value}>
                                  <Check class="size-3.5 text-accent shrink-0" />
                                </Show>
                              </MobileDrawer.Item>
                            )}
                          </For>
                        </MobileDrawer.Section>
                        {/* With a views group leading the drawer, title the action
                      sections to set the two apart. */}
                        <Show when={sections().length > 0}>
                          <MobileDrawer.Label>
                            {t('entityActions.actions')}
                          </MobileDrawer.Label>
                        </Show>
                      </>
                    )}
                  </Show>
                  <For each={sections().map((section) => section.key)}>
                    {(key, index) => {
                      const actions = () =>
                        sections().find((section) => section.key === key)!
                          .actions;
                      return (
                        <>
                          <Show when={index() > 0}>
                            <div class="mt-3" />
                          </Show>
                          <MobileDrawer.Section class="flex flex-col shrink-0">
                            <For
                              each={actions().map(
                                (action, index) => action.id ?? index
                              )}
                            >
                              {(id) =>
                                item(
                                  () =>
                                    actions().find(
                                      (action, index) =>
                                        (action.id ?? index) === id
                                    )!,
                                  false,
                                  id
                                )
                              }
                            </For>
                          </MobileDrawer.Section>
                        </>
                      );
                    }}
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
                        onBack={() => setPage(undefined)}
                        onActionComplete={close}
                      />
                    )}
                  </Show>
                }
              >
                {(menu) => (
                  <NotificationSettingsPage
                    {...menu()}
                    onBack={() => setPage(undefined)}
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
