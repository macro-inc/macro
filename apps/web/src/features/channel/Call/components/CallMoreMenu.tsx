import { t } from '@app/lib/i18n';
import { IS_MAC } from '@core/constant/isMac';
import CaretRight from '@icon/system/regular/caret-right.svg';
import CornersIn from '@icon/system/regular/corners-in.svg';
import CornersOut from '@icon/system/regular/corners-out.svg';
import DotsThree from '@icon/system/regular/dots-three-vertical.svg';
import Keyboard from '@icon/system/regular/keyboard.svg';
import LayoutIcon from '@icon/system/regular/sidebar-simple.svg';
import UsersSlash from '@icon/system/regular/users-slash.svg';
import { Popover } from '@kobalte/core/popover';
import { createElementSize } from '@solid-primitives/resize-observer';
import { Button, Dropdown, Hotkey, SingleSelectCheck, ToggleSwitch } from '@ui';
import {
  createContext,
  createSignal,
  For,
  type JSX,
  onCleanup,
  Show,
  useContext,
} from 'solid-js';
import { createStore } from 'solid-js/store';
import { type CallLayout, normalizeCallLayout } from '../core/call-layout';
import type { CallReactionEmoji } from '../core/call-reactions';
import { CallReactionRow } from './CallReactionMenu';

const layouts = [
  {
    value: 'auto',
    label: 'calls.layoutAuto',
    description: 'calls.layoutAutoDescription',
  },
  {
    value: 'grid',
    label: 'calls.layoutGrid',
    description: 'calls.layoutGridDescription',
  },
  {
    value: 'speaker',
    label: 'calls.layoutSpeaker',
    description: 'calls.layoutSpeakerDescription',
  },
  {
    value: 'sidebar',
    label: 'calls.layoutSidebar',
    description: 'calls.layoutSidebarDescription',
  },
] as const;

function LayoutThumbnail(props: { layout: CallLayout; selected: boolean }) {
  return (
    <div
      aria-hidden="true"
      class={`flex h-8 w-11 shrink-0 gap-0.5 rounded border p-0.5 ${props.selected ? 'bg-accent/10 border-accent/60 [&_.layout-cell]:bg-accent/70' : 'bg-surface-3 border-edge [&_.layout-cell]:bg-ink-muted/40'} ${props.layout === 'speaker' ? 'flex-col' : ''}`}
    >
      <Show
        when={props.layout === 'grid'}
        fallback={
          <>
            <div class="layout-cell flex-1 rounded-sm" />
            <div
              class={
                props.layout === 'speaker'
                  ? 'flex h-1.5 gap-0.5'
                  : 'flex w-2 flex-col gap-0.5'
              }
            >
              <For each={[0, 1, 2]}>
                {() => <div class="layout-cell flex-1 rounded-sm" />}
              </For>
            </div>
          </>
        }
      >
        <div class="grid w-full grid-cols-2 gap-0.5">
          <For each={[0, 1, 2, 3]}>
            {() => <div class="layout-cell rounded-sm" />}
          </For>
        </div>
      </Show>
    </div>
  );
}

type MenuContext = {
  menuElement: () => HTMLDivElement | undefined;
  requestShortcuts: () => void;
  compact: () => boolean;
};
const MoreMenuContext = createContext<MenuContext>();
function useMenu() {
  const menu = useContext(MoreMenuContext);
  if (!menu) throw new Error('More menu parts require CallMoreMenu.Root');
  return menu;
}
type CallMoreMenuState = {
  menuOpen: boolean;
  shortcutsOpen: boolean;
  shortcutsRequested: boolean;
  interactedOutside: boolean;
};
function Root(props: {
  compact?: boolean;
  onOpenChange: (open: boolean) => void;
  children: JSX.Element;
}) {
  const [trigger, setTrigger] = createSignal<HTMLButtonElement>();
  const [menuElement, setMenuElement] = createSignal<HTMLDivElement>();
  // Wait for menu dismissal before opening the shortcut dialog. Restore focus
  // only for keyboard dismissal, never after an outside pointer interaction.
  const [state, setState] = createStore<CallMoreMenuState>({
    menuOpen: false,
    shortcutsOpen: false,
    shortcutsRequested: false,
    interactedOutside: false,
  });
  let disposed = false;
  onCleanup(() => {
    disposed = true;
  });
  const setMenuOpen = (open: boolean) => {
    setState('menuOpen', open);
    props.onOpenChange(open || state.shortcutsOpen || state.shortcutsRequested);
  };
  const setShortcutsOpen = (open: boolean) => {
    setState({
      shortcutsOpen: open,
      ...(open ? { interactedOutside: false } : {}),
    });
    props.onOpenChange(open || state.menuOpen);
  };
  const menu = {
    state,
    setMenuOpen,
    setShortcutsOpen,
    requestShortcuts: () => {
      setState('shortcutsRequested', true);
      setMenuOpen(false);
    },
    finishMenuClose: () => {
      if (!state.shortcutsRequested) return state.shortcutsOpen;
      setState('shortcutsRequested', false);
      queueMicrotask(() => {
        if (!disposed) setShortcutsOpen(true);
      });
      return true;
    },
    interactOutside: () => setState('interactedOutside', true),
  };
  const menuOpen = () => menu.state.menuOpen;
  const shortcutsOpen = () => menu.state.shortcutsOpen;
  const onMenuOpenChange = menu.setMenuOpen;
  const onShortcutsOpenChange = menu.setShortcutsOpen;
  const shortcuts = [
    { label: 'calls.muteShortcut', shortcut: 'cmd+d' },
    { label: 'calls.cameraShortcut', shortcut: 'shift+cmd+e' },
    { label: 'calls.holdToTalkShortcut', shortcut: 'space' },
    {
      label: 'calls.fullscreenShortcut',
      shortcut: IS_MAC ? 'ctrl+cmd+f' : 'f11',
    },
  ] as const;
  return (
    <MoreMenuContext.Provider
      value={{
        menuElement,
        requestShortcuts: menu.requestShortcuts,
        compact: () => !!props.compact,
      }}
    >
      <Dropdown
        placement="top-start"
        open={menuOpen()}
        onOpenChange={onMenuOpenChange}
      >
        <Dropdown.Trigger
          ref={setTrigger}
          as={Button}
          variant="secondary"
          size={props.compact ? 'icon-md' : 'icon-lg'}
          aria-label={t('calls.more')}
          tooltip={t('calls.more')}
        >
          <DotsThree class="size-5" />
        </Dropdown.Trigger>
        <Show when={menuOpen() && !shortcutsOpen()}>
          <Dropdown.Content
            ref={setMenuElement}
            portalScope="local"
            class="min-w-64"
            onCloseAutoFocus={(event) => {
              if (menu.finishMenuClose()) event.preventDefault();
            }}
          >
            {props.children}
          </Dropdown.Content>
        </Show>
      </Dropdown>
      <Popover
        open={shortcutsOpen()}
        onOpenChange={onShortcutsOpenChange}
        placement="top-end"
        gutter={8}
        getAnchorRect={() => trigger()?.getBoundingClientRect()}
      >
        <Show when={shortcutsOpen()}>
          <Popover.Portal
            mount={
              trigger()?.closest<HTMLElement>('.portal-scope') ?? undefined
            }
          >
            <Popover.Content
              class="menu-surface z-action-menu min-w-72 max-w-[calc(100vw-1rem)] rounded-xl p-3 text-sm menu-open-animation outline-none"
              onInteractOutside={menu.interactOutside}
              onCloseAutoFocus={(event) => {
                event.preventDefault();
                if (!menu.state.interactedOutside) trigger()?.focus();
              }}
            >
              <Popover.Title class="mb-2 font-medium text-ink">
                {t('calls.keyboardShortcuts')}
              </Popover.Title>
              <ul class="flex flex-col gap-2">
                <For each={shortcuts}>
                  {(item) => (
                    <li class="flex items-center justify-between gap-4">
                      <span class="min-w-0 text-ink">{t(item.label)}</span>
                      <Hotkey shortcut={item.shortcut} theme="subtle" />
                    </li>
                  )}
                </For>
              </ul>
            </Popover.Content>
          </Popover.Portal>
        </Show>
      </Popover>
    </MoreMenuContext.Provider>
  );
}
function Layout(props: {
  layout: CallLayout;
  onLayoutChange: (layout: CallLayout) => void;
}) {
  const { menuElement } = useMenu();
  const [layoutMenu, setLayoutMenu] = createSignal<HTMLDivElement>();
  const layoutMenuSize = createElementSize(layoutMenu);
  const label = () =>
    layouts.find((item) => item.value === props.layout)?.label ??
    'calls.layoutAuto';
  return (
    <Dropdown.Sub
      shift={0}
      gutter={4}
      getAnchorRect={() => {
        const rect = menuElement()?.getBoundingClientRect();
        if (!rect) return undefined;
        return {
          x: rect.x,
          y: rect.bottom - (layoutMenuSize.height ?? 0),
          width: rect.width,
          height: 0,
        };
      }}
    >
      <Dropdown.SubTrigger>
        <LayoutIcon class="size-4" />
        <span class="flex-1">{t('calls.layout')}</span>
        <span class="text-ink-muted">{t(label())}</span>
        <CaretRight class="size-3" />
      </Dropdown.SubTrigger>
      <Dropdown.SubContent
        ref={setLayoutMenu}
        portalScope="local"
        class="w-80 min-w-max"
      >
        <Dropdown.Group>
          <Dropdown.RadioGroup
            value={props.layout}
            onChange={(value) =>
              props.onLayoutChange(normalizeCallLayout(value))
            }
          >
            <For each={layouts}>
              {(item) => (
                <Dropdown.RadioItem
                  value={item.value}
                  textValue={t(item.label)}
                  class="gap-3 py-2"
                >
                  <LayoutThumbnail
                    layout={item.value}
                    selected={props.layout === item.value}
                  />
                  <span class="min-w-0 flex-1">
                    <span class="block">{t(item.label)}</span>
                    <span class="block whitespace-nowrap text-xs text-ink-muted">
                      {t(item.description)}
                    </span>
                  </span>
                  <SingleSelectCheck active={props.layout === item.value} />
                </Dropdown.RadioItem>
              )}
            </For>
          </Dropdown.RadioGroup>
        </Dropdown.Group>
      </Dropdown.SubContent>
    </Dropdown.Sub>
  );
}
function Participants(props: {
  hasScreenShare: boolean;
  hideParticipants: boolean;
  onHideParticipantsChange: (hidden: boolean) => void;
}) {
  return (
    <Show when={props.hasScreenShare}>
      <Dropdown.CheckboxItem
        class="flex-row-reverse"
        checked={props.hideParticipants}
        disabled={!props.hasScreenShare}
        closeOnSelect={false}
        onChange={props.onHideParticipantsChange}
        indicator={
          <span inert aria-hidden="true">
            <ToggleSwitch
              checked={props.hideParticipants}
              disabled={!props.hasScreenShare}
            />
          </span>
        }
      >
        <span class="flex flex-1 items-center gap-1.5">
          <UsersSlash class="size-4" />
          <span class="flex-1">
            <span class="block">{t('calls.hideParticipants')}</span>
          </span>
        </span>
      </Dropdown.CheckboxItem>
    </Show>
  );
}
function Fullscreen(props: {
  fullscreen: boolean;
  fullscreenAvailable: boolean;
  onFullscreen: () => void;
}) {
  return (
    <Dropdown.Item
      onSelect={props.onFullscreen}
      disabled={!props.fullscreenAvailable}
    >
      <Show when={props.fullscreen} fallback={<CornersOut class="size-4" />}>
        <CornersIn class="size-4" />
      </Show>
      <span class="flex-1">
        {props.fullscreen ? t('calls.exitFullscreen') : t('calls.fullscreen')}
      </span>
      <Hotkey shortcut={IS_MAC ? 'ctrl+cmd+f' : 'f11'} theme="subtle" />
    </Dropdown.Item>
  );
}
function Shortcuts() {
  const menu = useMenu();
  return (
    <Dropdown.Item onSelect={menu.requestShortcuts}>
      <Keyboard class="size-4" />
      <span class="flex-1">{t('calls.keyboardShortcuts')}</span>
    </Dropdown.Item>
  );
}
function Reactions(props: { onReaction: (emoji: CallReactionEmoji) => void }) {
  const menu = useMenu();
  return (
    <Show when={menu.compact()}>
      <Dropdown.Group>
        <CallReactionRow inMenu onReaction={props.onReaction} />
      </Dropdown.Group>
    </Show>
  );
}
export const CallMoreMenu = {
  Root,
  Layout,
  Participants,
  Fullscreen,
  Shortcuts,
  Reactions,
};
