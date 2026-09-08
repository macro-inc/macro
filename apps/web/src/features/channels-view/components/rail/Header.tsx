import { runCreateAction } from '@app/features/command/Launcher';
import { openNewChannelModal } from '@channel/CreateChannelModal';
import { SplitPanel } from '@components/app/split-panel';
import { AnimatedSquareSidebarIcon } from '@icon/square-sidebar';
import ChannelIcon from '@icon/wide-channel.svg';
import ChatTeardropIcon from '@phosphor/chat-teardrop.svg';
import ChatTextIcon from '@phosphor/chat-text.svg';
import ChatsIcon from '@phosphor/chats-circle.svg';
import PlusIcon from '@phosphor/plus.svg';
import { Button, Dropdown, Tabs } from '@ui';
import { createSignal, Match, Switch } from 'solid-js';
import { useChannelRail } from './Context';

const CHANNEL_TABS = [
  {
    value: 'browse',
    label: 'Browse',
  },
  {
    value: 'recents',
    label: 'Recents',
  },
];

function BrowseTabLabel() {
  return (
    <>
      <span class="sr-only">Browse</span>
      <span aria-hidden="true" class="[&_svg]:size-4">
        <ChatsIcon />
      </span>
    </>
  );
}

function RecentsTabLabel() {
  return (
    <>
      <span class="sr-only">Recents</span>
      <span aria-hidden="true" class="[&_svg]:size-4">
        <ChatTextIcon />
      </span>
    </>
  );
}

const SLIM_CHANNEL_TABS = [
  {
    value: 'browse',
    label: BrowseTabLabel,
  },
  {
    value: 'recents',
    label: RecentsTabLabel,
  },
];

const openMessageComposer = () => runCreateAction('channel');

function RailModeButton() {
  const rail = useChannelRail();

  const expanded = () => rail.mode() === 'full';

  const [hovering, setHovering] = createSignal(false);

  return (
    <Button
      variant="ghost"
      size="icon-sm"
      label={expanded() ? 'Collapse chat rail' : 'Expand chat rail'}
      tooltipPlacement={expanded() ? 'bottom' : 'right'}
      onClick={() => rail.onModeChange(expanded() ? 'slim' : 'full')}
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
    >
      <AnimatedSquareSidebarIcon class="size-4" triggerAnimation={hovering()} />
    </Button>
  );
}

function SlimCreateMenu() {
  return (
    <Dropdown placement="right-start" gutter={8}>
      <Dropdown.Trigger
        variant="outline"
        size="icon-sm"
        class="size-10 rounded-full bg-transparent"
        label="Create conversation"
      >
        <PlusIcon class="size-4" />
      </Dropdown.Trigger>
      <Dropdown.Content class="min-w-44">
        <Dropdown.Group>
          <Dropdown.Item onSelect={() => openNewChannelModal()}>
            <ChannelIcon class="size-4 shrink-0" />
            <span>Create channel</span>
          </Dropdown.Item>
          <Dropdown.Item onSelect={openMessageComposer}>
            <ChatTeardropIcon class="size-4 shrink-0" />
            <span>Start direct message</span>
          </Dropdown.Item>
        </Dropdown.Group>
      </Dropdown.Content>
    </Dropdown>
  );
}

export function ChannelsRailHeader() {
  const rail = useChannelRail();

  const selectTab = (value: string) => {
    if (value !== 'browse' && value !== 'recents') return;

    rail.setTab(value);
  };

  return (
    <Switch>
      <Match when={rail.mode() === 'full'}>
        <div class="flex shrink-0 flex-col gap-3 px-4">
          <div class="flex items-center">
            <SplitPanel.ControlGroup>
              <SplitPanel.CloseButton />
              <SplitPanel.BackButton />
              <SplitPanel.ForwardButton />
            </SplitPanel.ControlGroup>
          </div>
          <div class="flex h-8 items-center gap-2">
            <RailModeButton />
            <h1 class="m-0 min-w-0 flex-1 truncate text-2xl font-semibold tracking-[-0.03em] text-ink">
              Chat
            </h1>
          </div>
          <Tabs
            aria-label="Chat sidebar views"
            fullWidth
            list={CHANNEL_TABS}
            value={rail.tab()}
            onChange={selectTab}
          />
        </div>
      </Match>
      <Match when={rail.mode() === 'slim'}>
        <div class="flex shrink-0 flex-col items-center gap-3">
          <div class="flex w-full items-center justify-center px-2">
            <SplitPanel.ControlGroup>
              <SplitPanel.CloseButton size="icon-sm" />
            </SplitPanel.ControlGroup>
          </div>
          <div class="flex h-8 w-full items-center justify-center px-2">
            <RailModeButton />
          </div>
          <div class="w-full px-3">
            <Tabs
              aria-label="Chat sidebar views"
              class="h-[76px] flex-col"
              itemClass="h-auto min-h-0 w-full"
              labelClass="size-full p-0"
              fullWidth
              list={SLIM_CHANNEL_TABS}
              value={rail.tab()}
              onChange={selectTab}
            />
          </div>
          <div class="w-full border-t border-edge-muted" />
          <div class="flex w-full justify-center px-2">
            <SlimCreateMenu />
          </div>
          <div class="w-full border-t border-edge-muted" />
        </div>
      </Match>
    </Switch>
  );
}
