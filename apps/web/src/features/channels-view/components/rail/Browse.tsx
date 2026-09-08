import { runCreateAction } from '@app/features/command/Launcher';
import { DEBUG_SETTING_KEYS, useDebugSetting } from '@app/lib/debugSettings';
import { openNewChannelModal } from '@channel/CreateChannelModal';
import ChannelIcon from '@icon/wide-channel.svg';
import CaretDownIcon from '@phosphor/caret-down.svg';
import ChatTeardropIcon from '@phosphor/chat-teardrop.svg';
import { Key } from '@solid-primitives/keyed';
import { cn } from '@ui';
import { type Component, For, Match, Show, Switch } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import type { ChannelsGroup } from '../../types';
import { ChannelsEmptyState } from '../ChannelsEmptyState';
import { useChannelRail } from './Context';
import { ChannelOption, SlimChannelItem } from './Item';
import { CollapsibleSection, CreateRailAction } from './Section';

type GroupConfig = {
  group: ChannelsGroup;
  label: string;
  emptyLabel: string;
  createLabel: string;
  icon: Component;
  onCreate: () => void;
};

const GROUPS: GroupConfig[] = [
  {
    group: 'channels',
    label: 'Channels',
    emptyLabel: 'No channels',
    createLabel: 'Create channel',
    icon: ChannelIcon,
    onCreate: openNewChannelModal,
  },
  {
    group: 'direct_messages',
    label: 'DMs',
    emptyLabel: 'No direct messages',
    createLabel: 'Start direct message',
    icon: ChatTeardropIcon,
    onCreate: () => runCreateAction('channel'),
  },
];

function ChannelGroupSection(props: { config: GroupConfig }) {
  const rail = useChannelRail();
  const forceEmptyState = useDebugSetting(
    DEBUG_SETTING_KEYS.FORCE_EMPTY_STATES
  );

  const group = () => props.config.group;

  const expanded = () => rail.mode() === 'full';

  const channels = () => rail.items(group());

  return (
    <CollapsibleSection.Root
      open={rail.section.isOpen(group())}
      fillAvailable={
        group() === 'direct_messages' && !rail.section.isOpen('channels')
      }
      class={expanded() ? undefined : 'items-center'}
    >
      <CollapsibleSection.Header
        focused={rail.section.isFocused(group())}
        focusWithin={rail.section.containsFocus(group())}
        class={
          expanded()
            ? 'h-9 has-[[data-section-action]:hover]:bg-transparent has-[[data-section-action]:focus-within]:bg-transparent'
            : 'h-10 justify-center'
        }
      >
        <button
          id={rail.section.domId(group())}
          type="button"
          role="treeitem"
          tabIndex={-1}
          class={cn(
            'relative flex outline-none focus-visible:ring-2 focus-visible:ring-accent',
            expanded()
              ? 'h-full min-w-0 flex-1 items-center gap-2 rounded-xl px-2 text-left'
              : 'size-10 min-w-10 flex-none items-center justify-center rounded-full'
          )}
          aria-expanded={rail.section.isOpen(group())}
          aria-label={expanded() ? undefined : props.config.label}
          onClick={() => rail.section.activate(group())}
        >
          <Switch>
            <Match when={expanded()}>
              <CaretDownIcon
                class={cn(
                  'size-3 shrink-0 transition-transform',
                  !rail.section.isOpen(group()) && '-rotate-90'
                )}
              />
              <span class="min-w-0 truncate">{props.config.label}</span>
            </Match>
            <Match when={true}>
              <span class="flex items-center justify-center [&_svg]:size-4">
                <Dynamic component={props.config.icon} />
              </span>
            </Match>
          </Switch>
          <Show when={rail.activity.unreadCount(group()) > 0}>
            <span
              class={cn(
                'flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-xs font-medium leading-none text-accent-contrast',
                expanded()
                  ? 'tabular-nums'
                  : 'absolute right-0 top-0 ring-2 ring-surface'
              )}
            >
              {rail.activity.unreadCount(group())}
            </span>
          </Show>
        </button>
        <Show when={expanded()}>
          <div data-section-action="" class="pr-1">
            <CreateRailAction
              label={props.config.createLabel}
              onClick={props.config.onCreate}
            />
          </div>
        </Show>
      </CollapsibleSection.Header>
      <CollapsibleSection.Content
        open={rail.section.isOpen(group())}
        contentRef={rail.section.registerScrollRef(group())}
        containerClass={expanded() ? undefined : 'w-full'}
        class={
          expanded()
            ? 'flex min-h-0 flex-col gap-0.5'
            : 'flex min-h-0 w-full flex-col items-center gap-0.5'
        }
        activityTargetId={rail.activity.targetId(group())}
        activityLabel={expanded() ? rail.activity.label(group()) : undefined}
        activityTooltip={!expanded()}
        onActivityVisible={(targetId) =>
          rail.activity.onVisible(group(), targetId)
        }
      >
        <Switch>
          <Match when={!forceEmptyState() && channels().length > 0}>
            <Key each={channels()} by={(channel) => channel.id}>
              {(channel) => (
                <Switch>
                  <Match when={expanded()}>
                    <ChannelOption
                      id={rail.item.domId(channel().id)}
                      channel={channel()}
                      unread={rail.activity.isUnread(channel().id)}
                      callStatus={rail.activity.callStatus(channel().id)}
                      incomingCallId={rail.activity.incomingCallId(
                        channel().id
                      )}
                      selected={rail.item.isSelected(channel().id)}
                      focused={rail.item.isFocused(channel().id)}
                      onActivate={() => rail.item.activate(channel().id)}
                    />
                  </Match>
                  <Match when={true}>
                    <SlimChannelItem
                      id={rail.item.domId(channel().id)}
                      channel={channel()}
                      unread={rail.activity.isUnread(channel().id)}
                      callStatus={rail.activity.callStatus(channel().id)}
                      selected={rail.item.isSelected(channel().id)}
                      focused={rail.item.isFocused(channel().id)}
                      onActivate={() => rail.item.activate(channel().id)}
                    />
                  </Match>
                </Switch>
              )}
            </Key>
          </Match>
          <Match when={expanded()}>
            <div class="px-2 py-2 text-xs text-ink-extra-muted">
              {props.config.emptyLabel}
            </div>
          </Match>
        </Switch>
      </CollapsibleSection.Content>
    </CollapsibleSection.Root>
  );
}

export function ChannelsRailBrowse() {
  const rail = useChannelRail();
  const forceEmptyState = useDebugSetting(
    DEBUG_SETTING_KEYS.FORCE_EMPTY_STATES
  );

  const hasItems = () =>
    rail.items('channels').length > 0 ||
    rail.items('direct_messages').length > 0;

  return (
    <Switch>
      <Match
        when={rail.mode() === 'full' && (forceEmptyState() || !hasItems())}
      >
        <ChannelsEmptyState scope="channels" topAligned />
      </Match>
      <Match when={true}>
        <div
          class={cn(
            'flex h-full min-h-0 flex-col gap-3',
            rail.mode() === 'full' ? 'px-4' : 'px-2'
          )}
        >
          <For each={GROUPS}>
            {(config) => <ChannelGroupSection config={config} />}
          </For>
        </div>
      </Match>
    </Switch>
  );
}
