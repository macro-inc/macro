import { CommandState } from '@app/features/command';
import { SidebarCreateMenu } from '@app/features/command/sidebar/sidebar-create-menu';
import { useAnalytics } from '@app/lib/analytics/analytics-context';
import { globalSplitManager } from '@app/signal/splitLayout';
import {
  buildBrainWorkspacePath,
  getLastBrainWorkspaceSelection,
} from '@components/app/split-layout/brainWorkspaceRoute';
import { useSplitLayout } from '@components/app/split-layout/layout';
import { DOCS_BASE } from '@app/constants/docs-links';
import { useLogout } from '@core/auth/logout';
import { useSettingsState } from '@core/constant/SettingsState';
import { staticFileSizedUrl } from '@core/constant/servers';
import { useUserContext } from '@core/context/user';
import { useProfilePictureUrl } from '@core/signal/profilePicture';
import LogoIcon from '@icon/macro-logo.svg';
import { AnimatedActivityIcon } from '@icon/wide-activity';
import BuildingsIcon from '@phosphor/buildings.svg';
import ChatIcon from '@phosphor/chats-circle.svg';
import CommandIcon from '@phosphor/command.svg';
import DotsNineIcon from '@phosphor/dots-nine.svg';
import EmailIcon from '@phosphor/envelope-simple.svg';
import GearIcon from '@phosphor/gear.svg';
import LaptopIcon from '@phosphor/laptop.svg';
import QuestionIcon from '@phosphor/question.svg';
import CircleBoldIcon from '@phosphor-icons/core/bold/circle-bold.svg?component-solid';
import BugIcon from '@phosphor/bug.svg';
import SignOutIcon from '@phosphor/sign-out.svg';
import DriveIcon from '@phosphor/shipping-container.svg';
import { Popover } from '@kobalte/core/popover';
import { useNavigate } from '@solidjs/router';
import { Avatar, Button, cn, Dropdown, Surface } from '@ui';
import {
  type Component,
  createMemo,
  createSignal,
  For,
  onCleanup,
  onMount,
  Show,
} from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { ExperimentalCalendarPopover } from './experimental-calendar-popover';
import { ExperimentalInboxPopover } from './experimental-inbox-popover';

type TopBarDestination = {
  id:
    | 'drive'
    | 'email'
    | 'chat'
    | 'todos'
    | 'agents'
    | 'crm'
    | 'activity';
  label: string;
  contentId: string;
  icon: Component<{ class?: string; triggerAnimation?: boolean }>;
  iconClass?: string;
  topBarClass?: string;
  topBarHideAt?: number;
  params?: Record<string, unknown>;
};

const LEFT_DESTINATIONS: readonly TopBarDestination[] = [
  { id: 'drive', label: 'Drive', contentId: 'documents', icon: DriveIcon },
  {
    id: 'email',
    label: 'Email',
    contentId: 'mail',
    icon: EmailIcon,
    topBarClass: 'max-[550px]:hidden',
    topBarHideAt: 550,
  },
  {
    id: 'chat',
    label: 'Chat',
    contentId: 'channels',
    icon: ChatIcon,
    topBarClass: 'max-[650px]:hidden',
    topBarHideAt: 650,
    params: {
      experimentalView: 'messages',
      initialTab: 'experimental-conversations',
    },
  },
  {
    id: 'todos',
    label: 'Todos',
    contentId: 'tasks',
    icon: CircleBoldIcon,
    topBarClass: 'max-[750px]:hidden',
    topBarHideAt: 750,
  },
  {
    id: 'agents',
    label: 'Agents',
    contentId: 'agents',
    icon: LaptopIcon,
    topBarClass: 'max-[850px]:hidden',
    topBarHideAt: 850,
  },
  {
    id: 'crm',
    label: 'CRM',
    contentId: 'companies',
    icon: BuildingsIcon,
  },
];

const ACTIVITY_DESTINATION: TopBarDestination = {
  id: 'activity',
  label: 'Activity',
  contentId: 'activity',
  icon: AnimatedActivityIcon,
};

function userInitials(label: string) {
  const parts = label.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0] ?? ''}${parts.at(-1)?.[0] ?? ''}`.toUpperCase();
}

function CurrentUserAvatar(props: {
  id: string;
  label: string;
  size?: 'md' | 'lg';
}) {
  const [profilePictureUrl] = useProfilePictureUrl(props.id);

  return (
    <Avatar size={props.size ?? 'md'} class="ring ring-edge-muted">
      <Show
        when={profilePictureUrl()}
        keyed
        fallback={
          <Avatar.Fallback class="font-semibold">
            {userInitials(props.label)}
          </Avatar.Fallback>
        }
      >
        {(url) => (
          <Avatar.Image
            src={staticFileSizedUrl(url, 'small')}
            alt={props.label}
            class="bg-surface"
            onError={(event) => {
              if (event.currentTarget.src !== url) {
                event.currentTarget.src = url;
              }
            }}
          />
        )}
      </Show>
    </Avatar>
  );
}

/** Top-bar-only global navigation used by Experimental v5. */
export function ExperimentalGlobalTopBar() {
  const analytics = useAnalytics();
  const layout = useSplitLayout();
  const navigate = useNavigate();
  const { openSettings } = useSettingsState();
  const logout = useLogout();
  const user = useUserContext();
  const [moreAppsOpen, setMoreAppsOpen] = createSignal(false);
  const [mockNotification, setMockNotification] = createSignal(false);
  const [viewportWidth, setViewportWidth] = createSignal(
    typeof window === 'undefined' ? Number.POSITIVE_INFINITY : window.innerWidth
  );

  onMount(() => {
    const updateViewportWidth = () => setViewportWidth(window.innerWidth);
    updateViewportWidth();
    window.addEventListener('resize', updateViewportWidth);
    onCleanup(() => window.removeEventListener('resize', updateViewportWidth));
  });

  const visibleLeftDestinations = createMemo(() => LEFT_DESTINATIONS);
  const primaryLeftDestinations = createMemo(() =>
    visibleLeftDestinations().filter((destination) => destination.id !== 'crm')
  );

  const isActive = (destination: TopBarDestination) => {
    const content = globalSplitManager()?.activeSplit()?.content();
    return content?.type === 'component' && content.id === destination.contentId;
  };
  const moreAppsActive = () =>
    visibleLeftDestinations().some((destination) => {
      if (!isActive(destination)) return false;
      if (destination.id === 'crm') return true;
      return (
        destination.topBarHideAt !== undefined &&
        viewportWidth() <= destination.topBarHideAt
      );
    });
  const openDestination = (
    destination: TopBarDestination,
    event: Pick<MouseEvent, 'shiftKey'>
  ) => {
    if (destination.id === 'agents' && !event.shiftKey && !isActive(destination)) {
      analytics.track('sidebar_click', { view: destination.id });
      navigate(buildBrainWorkspacePath(getLastBrainWorkspaceSelection()));
      globalSplitManager()?.returnFocus();
      return;
    }

    if (!event.shiftKey && isActive(destination)) {
      globalSplitManager()?.returnFocus();
      return;
    }

    analytics.track('sidebar_click', { view: destination.id });
    layout.openWithSplit(
      {
        type: 'component',
        id: destination.contentId,
        params: destination.params,
      },
      {
        preferNewSplit: event.shiftKey,
        mergeHistory: false,
        allowDuplicate: true,
        referredFrom: 'sidebar',
      }
    );
    globalSplitManager()?.returnFocus();
  };

  const openCommandMenu = () => {
    analytics.track('command_menu_open', { from: 'v5_topbar' });
    CommandState.open();
  };
  const DestinationButton = (props: { destination: TopBarDestination }) => (
    <button
      type="button"
      class={cn(
        'flex shrink-0 items-center gap-1.5 rounded-lg px-2 py-1 text-sm shadow-[0_0_4px_var(--color-drop-shadow)] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent/40',
        props.destination.topBarClass,
        isActive(props.destination)
          ? 'bg-active font-medium text-ink'
          : 'font-normal text-ink-extra-muted hover:bg-hover hover:text-ink-muted'
      )}
      aria-current={isActive(props.destination) ? 'page' : undefined}
      onMouseDown={(event) => {
        if (event.button === 0) event.preventDefault();
      }}
      onClick={(event) => openDestination(props.destination, event)}
    >
      <Dynamic
        component={props.destination.icon}
        class={cn('shrink-0', props.destination.iconClass ?? 'size-4')}
      />
      <span>{props.destination.label}</span>
    </button>
  );

  const IconDestinationButton = (props: {
    destination: TopBarDestination;
    active?: () => boolean;
    class?: string;
    onBeforeOpen?: () => void;
  }) => {
    const active = () => props.active?.() ?? isActive(props.destination);

    return (
      <Button
        variant="ghost"
        size="icon-sm"
        class={cn(
          'size-8 rounded-lg text-ink-muted [&_svg]:size-4!',
          active() && 'bg-active text-ink',
          props.class
        )}
        label={props.destination.label}
        tooltipPlacement="bottom"
        aria-label={props.destination.label}
        aria-current={active() ? 'page' : undefined}
        onMouseDown={(event: MouseEvent) => {
          if (event.button === 0) event.preventDefault();
        }}
        onClick={(event: MouseEvent) => {
          props.onBeforeOpen?.();
          openDestination(props.destination, event);
        }}
      >
        <Dynamic component={props.destination.icon} />
      </Button>
    );
  };

  return (
    <header class="flex min-w-0 shrink-0 items-center gap-2 bg-page p-2">
      <div class="flex shrink-0 items-center gap-1 pr-1">
        <span class="flex size-8 items-center justify-center text-accent">
          <LogoIcon class="size-5" />
        </span>
        <span class="text-sm font-semibold text-ink max-[600px]:hidden">
          Macro
        </span>
      </div>

      <nav
        aria-label="Apps"
        class="scrollbar-hidden flex min-w-0 items-center gap-0.5 overflow-x-auto"
      >
        <For each={primaryLeftDestinations()}>
          {(destination) => <DestinationButton destination={destination} />}
        </For>
        <Popover
          open={moreAppsOpen()}
          onOpenChange={setMoreAppsOpen}
          placement="bottom-start"
          gutter={6}
          flip
        >
          <Popover.Trigger
            type="button"
            class={cn(
              'flex size-7 shrink-0 items-center justify-center rounded-lg shadow-[0_0_4px_var(--color-drop-shadow)] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent/40',
              moreAppsOpen() || moreAppsActive()
                ? 'bg-active font-medium text-ink'
                : 'font-normal text-ink-extra-muted hover:bg-hover hover:text-ink-muted'
            )}
            aria-label="More apps"
          >
            <DotsNineIcon class="size-4" />
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Content class="z-action-menu w-72 max-w-[calc(100vw-1rem)] outline-none">
              <Surface
                depth={4}
                class="grid grid-cols-3 gap-1 rounded-xl bg-menu p-2 shadow-menu"
              >
                <For each={visibleLeftDestinations()}>
                  {(destination) => (
                    <button
                      type="button"
                      class={cn(
                        'flex min-w-0 flex-col items-center gap-1.5 rounded-xl px-2 py-3 text-xs outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent/40',
                        isActive(destination)
                          ? 'bg-active font-medium text-ink'
                          : 'font-normal text-ink-muted hover:bg-hover hover:text-ink'
                      )}
                      aria-current={
                        isActive(destination) ? 'page' : undefined
                      }
                      onClick={(event) => {
                        setMoreAppsOpen(false);
                        openDestination(destination, event);
                      }}
                    >
                      <Dynamic
                        component={destination.icon}
                        class="size-5 shrink-0"
                      />
                      <span class="max-w-full truncate">
                        {destination.label}
                      </span>
                    </button>
                  )}
                </For>
              </Surface>
            </Popover.Content>
          </Popover.Portal>
        </Popover>
      </nav>

      <div class="min-w-4 flex-1" />

      <nav aria-label="Global views" class="flex shrink-0 items-center gap-0.5">
        <IconDestinationButton
          destination={ACTIVITY_DESTINATION}
          class="max-[1100px]:hidden"
        />
        <ExperimentalCalendarPopover />
        <ExperimentalInboxPopover hasMockNotification={mockNotification()} />
        <span
          aria-hidden="true"
          class="mx-1 h-4 w-px shrink-0 bg-edge-muted"
        />
        <SidebarCreateMenu
          isSlim={() => true}
          variant="icon"
          icon="create"
          filled
          showLabel
          placement="bottom-start"
          triggerClass="h-8! w-auto! gap-1.5! rounded-lg px-2! [&_svg]:size-4!"
        />
        <Button
          variant="ghost"
          size="icon-sm"
          class="size-8 rounded-lg text-ink-muted max-[1100px]:hidden"
          label="Command menu"
          tooltipPlacement="bottom"
          aria-label="Command menu"
          onClick={openCommandMenu}
        >
          <CommandIcon />
        </Button>
      </nav>

      <Dropdown placement="bottom-end" gutter={6}>
        <Dropdown.Trigger
          variant="ghost"
          size="icon-sm"
          class="-ml-1 size-8 rounded-lg p-0"
          aria-label={`Open account menu for ${user.author()}`}
        >
          <Show
            when={user.userId()}
            keyed
            fallback={
              <Avatar size="md" class="ring ring-edge-muted">
                <Avatar.Fallback class="font-semibold">
                  {userInitials(user.author())}
                </Avatar.Fallback>
              </Avatar>
            }
          >
            {(id) => <CurrentUserAvatar id={id} label={user.author()} />}
          </Show>
        </Dropdown.Trigger>
        <Dropdown.Content class="min-w-64 max-w-[calc(100vw-1rem)] shadow-menu">
          <Dropdown.Group class="gap-0 p-1.5">
            <div class="flex min-w-0 items-center gap-3 px-1 py-1.5">
              <Show
                when={user.userId()}
                keyed
                fallback={
                  <Avatar size="lg" class="ring ring-edge-muted">
                    <Avatar.Fallback class="font-semibold">
                      {userInitials(user.author())}
                    </Avatar.Fallback>
                  </Avatar>
                }
              >
                {(id) => (
                  <CurrentUserAvatar
                    id={id}
                    label={user.author()}
                    size="lg"
                  />
                )}
              </Show>
              <div class="min-w-0">
                <div class="truncate text-sm font-semibold text-ink">
                  {user.author()}
                </div>
                <div class="truncate text-sm text-ink-muted">
                  {user.email()}
                </div>
              </div>
            </div>
            <div class="-mx-1.5 mb-1.5 mt-2 h-px bg-edge-muted" />
            <Dropdown.Item
              class="flex cursor-default items-center gap-2 px-2.5 py-2 text-sm text-ink-muted outline-none min-[1101px]:hidden"
              onSelect={() =>
                openDestination(ACTIVITY_DESTINATION, { shiftKey: false })
              }
            >
              <span class="flex size-5 items-center justify-center">
                <AnimatedActivityIcon class="size-4 text-ink-extra-muted" />
              </span>
              <span class="flex-1 text-ink">Activity</span>
            </Dropdown.Item>
            <Dropdown.Item
              class="flex cursor-default items-center gap-2 px-2.5 py-2 text-sm text-ink-muted outline-none min-[1101px]:hidden"
              onSelect={openCommandMenu}
            >
              <span class="flex size-5 items-center justify-center">
                <CommandIcon class="size-4 text-ink-extra-muted" />
              </span>
              <span class="flex-1 text-ink">Command menu</span>
            </Dropdown.Item>
            <div class="-mx-1.5 mb-1.5 mt-2 hidden h-px bg-edge-muted max-[1100px]:block" />
            <Dropdown.Item
              class="flex cursor-default items-center gap-2 px-2.5 py-2 text-sm text-ink-muted outline-none"
              onSelect={() => openSettings('Account')}
            >
              <span class="flex size-5 items-center justify-center">
                <GearIcon class="size-4 text-ink-extra-muted" />
              </span>
              <span class="flex-1 text-ink">Settings</span>
            </Dropdown.Item>
            <Dropdown.Item
              class="flex cursor-default items-center gap-2 px-2.5 py-2 text-sm text-ink-muted outline-none"
              onSelect={() =>
                window.open(DOCS_BASE, '_blank', 'noopener,noreferrer')
              }
            >
              <span class="flex size-5 items-center justify-center">
                <QuestionIcon class="size-4 text-ink-extra-muted" />
              </span>
              <span class="flex-1 text-ink">Help</span>
            </Dropdown.Item>
            <Dropdown.Item
              class="flex cursor-default items-center gap-2 px-2.5 py-2 text-sm text-failure outline-none"
              onSelect={() => logout()}
            >
              <span class="flex size-5 items-center justify-center">
                <SignOutIcon class="size-4" />
              </span>
              <span>Log out</span>
            </Dropdown.Item>
          </Dropdown.Group>
        </Dropdown.Content>
      </Dropdown>

      <div class="fixed bottom-4 right-4 z-action-menu">
        <Dropdown placement="top-end" gutter={6}>
          <Dropdown.Trigger
            variant="base"
            size="sm"
            class="h-8 gap-1.5 rounded-lg bg-menu px-2.5 text-ink shadow-menu"
            label="Open debug controls"
            tooltipPlacement="top"
          >
            <BugIcon class="size-4" />
            <span>Debug</span>
          </Dropdown.Trigger>
          <Dropdown.Content class="min-w-52 shadow-menu">
            <Dropdown.Group>
              <Dropdown.Item
                class="flex cursor-default items-center gap-2 px-2.5 py-2 text-sm text-ink outline-none"
                onSelect={() => setMockNotification((value) => !value)}
              >
                <span
                  class={cn(
                    'size-2 rounded-full border border-edge-muted',
                    mockNotification() && 'border-accent bg-accent'
                  )}
                />
                <span>
                  {mockNotification()
                    ? 'Clear mock notification'
                    : 'Mock notification'}
                </span>
              </Dropdown.Item>
            </Dropdown.Group>
          </Dropdown.Content>
        </Dropdown>
      </div>
    </header>
  );
}
