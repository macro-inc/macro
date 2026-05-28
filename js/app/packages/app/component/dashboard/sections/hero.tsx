import { useGlobalNotificationSource } from '@app/component/GlobalAppState';
import { setInviteModalOpen } from '@app/component/app-sidebar/invite-modal';
import { CommandState } from '@app/component/command';
import { DashboardNotificationList } from '@app/component/dashboard/sections/notifications';
import { MobileDrawer } from '@app/component/mobile/MobileDrawer';
import { setCreateMenuOpen } from '@app/component/Launcher';
import { globalSplitManager } from '@app/signal/splitLayout';
import { buildChatEditor } from '@core/component/AI/component/input/buildChatEditor';
import type { ChatSendInput } from '@core/component/AI/component/input/buildRequest';
import { ChatInput } from '@core/component/AI/component/input/ChatInput';
import { ChatInputProvider } from '@core/component/AI/context';
import { setPendingSendData } from '@core/component/AI/signal/pendingSend';
import { setAutomationComposerOpen } from '@block-automation/component';
import { useSettingsState } from '@core/constant/SettingsState';
import BellIcon from '@phosphor/bell.svg';
import GearIcon from '@phosphor/gear.svg';
import PlusIcon from '@phosphor/plus.svg';
import RobotIcon from '@phosphor/robot.svg';
import SearchIcon from '@phosphor/magnifying-glass.svg';
import UsersThreeIcon from '@phosphor/users-three.svg';
import MoreIcon from '@phosphor-icons/core/fill/dots-three-outline-fill.svg?component-solid';
import CloudSunIcon from '@phosphor/cloud-sun.svg';
import MoonStarsIcon from '@phosphor/moon-stars.svg';
import SunHorizonIcon from '@phosphor/sun-horizon.svg';
import { notificationIsRead } from '@notifications';
import { cognitionApiServiceClient } from '@service-cognition/client';
import { Button, Dropdown } from '@ui';
import { createMemo, createSignal, Show } from 'solid-js';

import { useUserContext } from '@core/context/user';
import { isMobile } from '@core/mobile/isMobile';
import { Dynamic } from 'solid-js/web';

function openAutomationsView() {
  globalSplitManager()?.openWithSplit(
    { type: 'component', id: 'agents' },
    {
      activate: true,
      referredFrom: 'dashboard',
    }
  );
}

function DashboardAiInput() {
  const editor = buildChatEditor();

  const handleSend = async (request: ChatSendInput) => {
    const response = await cognitionApiServiceClient.createChat({});
    if (response.isErr()) return;

    setPendingSendData({
      content: request.content,
      attachments: request.attachments,
      model: request.model,
    });

    globalSplitManager()?.openWithSplit(
      { type: 'chat', id: response.value.id },
      {
        activate: true,
        referredFrom: null,
        preferNewSplit: request.metaKey,
      }
    );
  };

  return (
    <ChatInputProvider>
      <ChatInput editor={editor} onSend={handleSend} isPersistent />
    </ChatInputProvider>
  );
}

export function Hero() {
  const user = useUserContext();
  const { openSettings } = useSettingsState();
  const notificationSource = useGlobalNotificationSource();
  const [moreDrawerOpen, setMoreDrawerOpen] = createSignal(false);
  const [moreDropdownOpen, setMoreDropdownOpen] = createSignal(false);
  const [notificationsOpen, setNotificationsOpen] = createSignal(false);

  const firstName = createMemo(() => {
    const name = user.author();
    return name.includes('@') ? name.split('@')[0] : name.split(' ')[0];
  });

  const timeOfDay = createMemo(() => {
    const hour = new Date().getHours();
    if (hour < 12) return 'morning';
    if (hour < 18) return 'afternoon';
    return 'evening';
  });

  const greeting = createMemo(() => `Good ${timeOfDay()}`);
  const GreetingIcon = createMemo(() => {
    if (timeOfDay() === 'morning') return SunHorizonIcon;
    if (timeOfDay() === 'afternoon') return CloudSunIcon;
    return MoonStarsIcon;
  });

  const unreadNotifications = createMemo(() =>
    notificationSource
      .notifications()
      .filter(
        (notification) =>
          !notification.done && !notificationIsRead(notification)
      )
      .sort(
        (a, b) =>
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      )
  );

  return (
    <section class="relative py-8 sm:py-14">
      <div class="mx-auto flex max-w-3xl flex-col items-center gap-6">
        <div class="flex w-full items-start justify-between gap-3 sm:justify-center">
          <h1 class="flex min-w-0 items-center gap-2 text-balance text-4xl font-semibold tracking-tight text-ink sm:justify-center sm:text-center lg:text-5xl">
            <Dynamic
              component={GreetingIcon()}
              class="hidden sm:block mt-1 self-start size-8 lg:size-10 shrink-0 text-accent"
            />
            <span>
              {greeting()}, <span class="capitalize">{firstName()}.</span>
            </span>
          </h1>
          <Button
            variant="base"
            size="icon-md"
            class="relative shrink-0 rounded-lg bg-surface sm:hidden"
            aria-label="Notifications"
            onClick={() => setNotificationsOpen(true)}
          >
            <BellIcon class="size-4" />
            <Show when={unreadNotifications().length > 0}>
              <span class="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[0.625rem] font-bold text-surface">
                {unreadNotifications().length > 99
                  ? '99+'
                  : unreadNotifications().length}
              </span>
            </Show>
          </Button>
        </div>

        <MobileDrawer
          open={notificationsOpen()}
          onOpenChange={setNotificationsOpen}
        >
          <MobileDrawer.Portal>
            <MobileDrawer.Overlay class="fixed inset-0 z-modal-overlay bg-modal-overlay" />
            <MobileDrawer.Content
              aria-label="Notifications"
              class="h-[calc(100vh-var(--safe-top))] max-h-[calc(100vh-var(--safe-top))]"
            >
              <MobileDrawer.Handle />
              <div class="flex min-h-0 flex-1 flex-col px-4 pb-4">
                <div class="flex shrink-0 items-center justify-between py-3">
                  <h2 class="text-base font-semibold text-ink">
                    Notifications
                  </h2>
                  <Show when={unreadNotifications().length > 0}>
                    <span class="text-xxs text-ink-extra-muted">
                      {unreadNotifications().length} unread
                    </span>
                  </Show>
                </div>
                <Show
                  when={unreadNotifications().length > 0}
                  fallback={
                    <div class="flex flex-1 flex-col items-center justify-center text-center">
                      <p class="text-sm font-medium text-ink">All caught up</p>
                      <p class="mt-1 text-xs text-ink-muted">
                        No unread notifications
                      </p>
                    </div>
                  }
                >
                  <DashboardNotificationList
                    notifications={unreadNotifications()}
                    class="max-h-full flex-1"
                  />
                </Show>
              </div>
            </MobileDrawer.Content>
          </MobileDrawer.Portal>
        </MobileDrawer>

        <div class="w-full max-w-2xl text-left">
          <DashboardAiInput />
        </div>

        <div class="flex w-full flex-wrap justify-start gap-3 sm:justify-center">
          <Button
            variant="cta"
            size="lg"
            class="h-10 rounded-lg px-4 text-sm"
            onClick={() => setCreateMenuOpen(true)}
          >
            <PlusIcon />
            Create
          </Button>
          <Button
            variant="base"
            size="lg"
            class="h-10 rounded-lg px-4 text-sm"
            onClick={() => CommandState.open()}
          >
            <SearchIcon class="size-4" />
            <span class="hidden sm:inline">Search</span>
          </Button>
          <Button
            variant="base"
            size="lg"
            class="h-10 rounded-lg px-3 text-sm sm:hidden"
            aria-label="More dashboard actions"
            onClick={() => setMoreDrawerOpen(true)}
          >
            <MoreIcon class="size-4" />
          </Button>

          <MobileDrawer
            open={moreDrawerOpen()}
            onOpenChange={setMoreDrawerOpen}
          >
            <MobileDrawer.Portal>
              <MobileDrawer.Overlay class="fixed inset-0 z-modal-overlay bg-modal-overlay sm:hidden" />
              <MobileDrawer.Content
                aria-label="More dashboard actions"
                class="sm:hidden"
              >
                <MobileDrawer.Handle />
                <div class="flex flex-col gap-2 px-3 pb-4">
                  <Button
                    variant="ghost"
                    size="lg"
                    class="h-11 justify-start rounded-lg px-3"
                    onClick={() => {
                      setMoreDrawerOpen(false);
                      setInviteModalOpen(true);
                    }}
                  >
                    <UsersThreeIcon class="size-4 shrink-0" />
                    Invite teammate
                  </Button>
                  <Button
                    variant="ghost"
                    size="lg"
                    class="h-11 justify-start rounded-lg px-3"
                    onClick={() => {
                      setMoreDrawerOpen(false);
                      setAutomationComposerOpen(true, false);
                    }}
                  >
                    <RobotIcon class="size-4 shrink-0" />
                    Create automation
                  </Button>
                  <Button
                    variant="ghost"
                    size="lg"
                    class="h-11 justify-start rounded-lg px-3"
                    onClick={() => {
                      setMoreDrawerOpen(false);
                      openSettings('Team');
                    }}
                  >
                    <GearIcon class="size-4 shrink-0" />
                    Team settings
                  </Button>
                  <Button
                    variant="ghost"
                    size="lg"
                    class="h-11 justify-start rounded-lg px-3"
                    onClick={() => {
                      setMoreDrawerOpen(false);
                      openAutomationsView();
                    }}
                  >
                    <RobotIcon class="size-4 shrink-0" />
                    View automations
                  </Button>
                </div>
              </MobileDrawer.Content>
            </MobileDrawer.Portal>
          </MobileDrawer>

          <Show when={!isMobile()}>
            <Dropdown
              open={moreDropdownOpen()}
              onOpenChange={setMoreDropdownOpen}
              placement="bottom-end"
            >
              <Dropdown.Trigger
                variant="base"
                size="lg"
                class="hidden h-10 rounded-lg px-3 text-sm sm:inline-flex"
                aria-label="More dashboard actions"
              >
                <MoreIcon class="size-4" />
                <span>More</span>
              </Dropdown.Trigger>
              <Dropdown.Content class="min-w-48">
                <Dropdown.Group>
                  <Dropdown.Item onSelect={() => setInviteModalOpen(true)}>
                    <UsersThreeIcon class="size-4 shrink-0 text-ink-muted" />
                    <span class="flex-1 truncate text-ink-muted">
                      Invite teammate
                    </span>
                  </Dropdown.Item>
                  <Dropdown.Item
                    onSelect={() => setAutomationComposerOpen(true, false)}
                  >
                    <RobotIcon class="size-4 shrink-0 text-ink-muted" />
                    <span class="flex-1 truncate text-ink-muted">
                      Create automation
                    </span>
                  </Dropdown.Item>
                  <Dropdown.Item onSelect={() => openSettings('Team')}>
                    <GearIcon class="size-4 shrink-0 text-ink-muted" />
                    <span class="flex-1 truncate text-ink-muted">
                      Team settings
                    </span>
                  </Dropdown.Item>
                  <Dropdown.Item onSelect={openAutomationsView}>
                    <RobotIcon class="size-4 shrink-0 text-ink-muted" />
                    <span class="flex-1 truncate text-ink-muted">
                      View automations
                    </span>
                  </Dropdown.Item>
                </Dropdown.Group>
              </Dropdown.Content>
            </Dropdown>
          </Show>
        </div>
      </div>
    </section>
  );
}
