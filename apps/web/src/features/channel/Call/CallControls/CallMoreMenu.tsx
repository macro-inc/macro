import { t } from '@app/lib/i18n';
import { IS_MAC } from '@core/constant/isMac';
import CaretRight from '@icon/system/regular/caret-right.svg';
import CornersIn from '@icon/system/regular/corners-in.svg';
import CornersOut from '@icon/system/regular/corners-out.svg';
import DotsThree from '@icon/system/regular/dots-three.svg';
import Keyboard from '@icon/system/regular/keyboard.svg';
import LayoutIcon from '@icon/system/regular/sidebar-simple.svg';
import { Popover } from '@kobalte/core/popover';
import { Button, Dropdown, Hotkey, SingleSelectCheck, ToggleSwitch } from '@ui';
import { createSignal, For, type JSX, Show } from 'solid-js';
import { type CallLayout, normalizeCallLayout } from '../call-layout';
import {
  CALL_REACTION_EMOJIS,
  type CallReactionEmoji,
} from '../call-reactions';

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

function LayoutThumbnail(props: { layout: CallLayout }) {
  return (
    <div
      aria-hidden="true"
      class={`flex h-8 w-11 shrink-0 gap-0.5 rounded border border-edge-muted p-0.5 ${props.layout === 'speaker' ? 'flex-col' : ''}`}
    >
      <Show
        when={props.layout === 'grid'}
        fallback={
          <>
            <div class="flex-1 rounded-sm bg-ink-muted" />
            <div
              class={
                props.layout === 'speaker'
                  ? 'flex h-1.5 gap-0.5'
                  : 'flex w-2 flex-col gap-0.5'
              }
            >
              <For each={[0, 1, 2]}>
                {() => <div class="flex-1 rounded-sm bg-ink-extra-muted" />}
              </For>
            </div>
          </>
        }
      >
        <div class="grid w-full grid-cols-2 gap-0.5">
          <For each={[0, 1, 2, 3]}>
            {() => <div class="rounded-sm bg-ink-muted" />}
          </For>
        </div>
      </Show>
    </div>
  );
}

export function CallMoreMenu(props: {
  compact?: boolean;
  layout: CallLayout;
  onLayoutChange: (layout: CallLayout) => void;
  hasScreenShare: boolean;
  hideParticipants: boolean;
  onHideParticipantsChange: (hidden: boolean) => void;
  onOpenChange: (open: boolean) => void;
  children?: JSX.Element;
  onReaction?: (emoji: CallReactionEmoji) => void;
  fullscreen?: boolean;
  fullscreenAvailable?: boolean;
  onFullscreen?: () => void;
}) {
  const label = () =>
    layouts.find((item) => item.value === props.layout)?.label ??
    'calls.layoutAuto';
  const [trigger, setTrigger] = createSignal<HTMLButtonElement>();
  const [menuOpen, setMenuOpen] = createSignal(false);
  const [shortcutsOpen, setShortcutsOpen] = createSignal(false);
  let shortcutsInteractedOutside = false;
  const onMenuOpenChange = (open: boolean) => {
    setMenuOpen(open);
    props.onOpenChange(open || shortcutsOpen());
  };
  const onShortcutsOpenChange = (open: boolean) => {
    if (open) shortcutsInteractedOutside = false;
    setShortcutsOpen(open);
    props.onOpenChange(open || menuOpen());
  };
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
    <>
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
            portalScope="local"
            class="min-w-64"
            onCloseAutoFocus={(event) => {
              if (shortcutsOpen()) event.preventDefault();
            }}
          >
            <Show when={props.onReaction}>
              <Dropdown.Group>
                <Dropdown.GroupLabel>
                  {t('calls.reactions')}
                </Dropdown.GroupLabel>
                <div class="flex items-center justify-between gap-1 px-1">
                  <For each={CALL_REACTION_EMOJIS}>
                    {(emoji) => (
                      <Button
                        variant="secondary"
                        size="icon-lg"
                        aria-label={emoji}
                        onClick={() => props.onReaction?.(emoji)}
                      >
                        <span class="text-xl">{emoji}</span>
                      </Button>
                    )}
                  </For>
                </div>
              </Dropdown.Group>
            </Show>
            <Dropdown.Group>
              <Dropdown.Sub>
                <Dropdown.SubTrigger>
                  <LayoutIcon class="size-4" />
                  <span class="flex-1">{t('calls.layout')}</span>
                  <span class="text-ink-muted">{t(label())}</span>
                  <CaretRight class="size-3" />
                </Dropdown.SubTrigger>
                <Dropdown.SubContent portalScope="local" class="w-80">
                  <Dropdown.Group>
                    <Dropdown.GroupLabel>
                      {t('calls.layout')}
                    </Dropdown.GroupLabel>
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
                            <LayoutThumbnail layout={item.value} />
                            <span class="min-w-0 flex-1">
                              <span class="block">{t(item.label)}</span>
                              <span class="block text-xs text-ink-muted">
                                {t(item.description)}
                              </span>
                            </span>
                            <SingleSelectCheck
                              active={props.layout === item.value}
                            />
                          </Dropdown.RadioItem>
                        )}
                      </For>
                    </Dropdown.RadioGroup>
                  </Dropdown.Group>
                  <Dropdown.Group>
                    <p class="px-2 py-1 text-xs text-ink-muted">
                      {t('calls.layoutRemembered')}
                    </p>
                  </Dropdown.Group>
                </Dropdown.SubContent>
              </Dropdown.Sub>
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
                  <CornersIn class="size-4" />
                  <span class="flex-1">
                    <span class="block">{t('calls.hideParticipants')}</span>
                    <span class="block text-xs text-ink-muted">
                      {props.hasScreenShare
                        ? t('calls.forThisCall')
                        : t('calls.whileSharing')}
                    </span>
                  </span>
                </span>
              </Dropdown.CheckboxItem>
              <Dropdown.Item
                onSelect={props.onFullscreen}
                disabled={!props.fullscreenAvailable}
              >
                <Show
                  when={props.fullscreen}
                  fallback={<CornersOut class="size-4" />}
                >
                  <CornersIn class="size-4" />
                </Show>
                <span class="flex-1">
                  {props.fullscreen
                    ? t('calls.exitFullscreen')
                    : t('calls.fullscreen')}
                </span>
                <Hotkey
                  shortcut={IS_MAC ? 'ctrl+cmd+f' : 'f11'}
                  theme="subtle"
                />
              </Dropdown.Item>
            </Dropdown.Group>
            <Dropdown.Separator class="my-1 h-px bg-edge-divider" />
            <Dropdown.Group>
              <Dropdown.Item
                onSelect={() => {
                  setMenuOpen(false);
                  onShortcutsOpenChange(true);
                }}
              >
                <Keyboard class="size-4" />
                <span class="flex-1">{t('calls.keyboardShortcuts')}</span>
              </Dropdown.Item>
            </Dropdown.Group>
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
              onInteractOutside={() => {
                shortcutsInteractedOutside = true;
              }}
              onCloseAutoFocus={(event) => {
                event.preventDefault();
                if (!shortcutsInteractedOutside) trigger()?.focus();
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
    </>
  );
}
