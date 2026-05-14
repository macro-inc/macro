import { useSplitLayout } from '@app/component/split-layout/layout';
import { UserIcon } from '@core/component/UserIcon';
import { useUserContext } from '@core/context/user';
import { DisplayName } from '@entity';
import BellIcon from '@icon/regular/bell.svg';
import GearIcon from '@icon/regular/gear.svg';
import SearchIcon from '@icon/regular/magnifying-glass.svg';
import SignOutIcon from '@icon/regular/sign-out.svg';
import UserCircleIcon from '@icon/regular/user-circle.svg';
import { useUserNotificationsQuery } from '@queries/notification/user-notifications';
import { DropdownMenu } from '@kobalte/core/dropdown-menu';
import { Dropdown } from '@ui';
import { createMemo, Show } from 'solid-js';

import { ActivitySection } from './sections/activity-section';
import { AISearchSection } from './sections/ai-search-section';
import { ContactsSection } from './sections/contacts-section';
import { DraftsSection } from './sections/drafts-section';
import { QuickActionsSection } from './sections/quick-actions-section';
import { RecentChatsSection } from './sections/recent-chats-section';
import { RecentItemsSection } from './sections/recent-items-section';
import { TasksSection } from './sections/tasks-section';
import { TeamSection } from './sections/team-section';

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

function getFormattedDate(): string {
  return new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
}

export function Dashboard() {
  const user = useUserContext();
  const { openWithSplit } = useSplitLayout();

  const notificationsQuery = useUserNotificationsQuery({ limit: 20 });
  const unreadCount = createMemo(() => {
    const items = notificationsQuery.data ?? [];
    return items.filter((n) => !n.done && !n.viewed_at).length;
  });

  const handleSearch = () => {
    openWithSplit({ type: 'component', id: 'search' });
  };

  const handleNotifications = () => {
    openWithSplit({ type: 'component', id: 'inbox' });
  };

  return (
    <main class="h-full overflow-y-auto bg-page">
      <div class="max-w-[1600px] mx-auto px-4 py-8 sm:px-6 lg:px-12">
        {/* Header row */}
        <header class="flex items-start justify-between gap-6 mb-10">
          <div>
            <p class="text-xs text-ink-muted mb-1">{getFormattedDate()}</p>
            <h1 class="text-3xl font-semibold text-ink">
              {getGreeting()}
              <Show when={user.userId()}>
                , <DisplayName id={user.userId()!} format="firstName" />
              </Show>
            </h1>
            <div class="mt-5">
              <QuickActionsSection />
            </div>
          </div>
          <div class="flex items-center gap-2">
            <button
              type="button"
              onClick={handleSearch}
              class="size-10 rounded-full flex items-center justify-center text-ink-muted hover:text-ink hover:bg-ink/5 transition-colors"
              title="Search (⌘K)"
            >
              <SearchIcon class="size-5" />
            </button>
            <button
              type="button"
              onClick={handleNotifications}
              class="size-10 rounded-full flex items-center justify-center text-ink-muted hover:text-ink hover:bg-ink/5 transition-colors relative"
              title="Notifications"
            >
              <BellIcon class="size-5" />
              <Show when={unreadCount() > 0}>
                <span class="absolute top-1 right-1 size-4 rounded-full bg-accent text-white text-[10px] font-medium flex items-center justify-center">
                  {unreadCount() > 9 ? '9+' : unreadCount()}
                </span>
              </Show>
            </button>
            <Show when={user.userId()}>
              <DropdownMenu>
                <DropdownMenu.Trigger class="ml-1 rounded-full cursor-pointer">
                  <UserIcon id={user.userId()!} size="lg" suppressClick showTooltip={false} />
                </DropdownMenu.Trigger>
                <DropdownMenu.Portal>
                  <DropdownMenu.Content class="z-action-menu bg-surface border border-edge-muted rounded-lg shadow-sm min-w-40 p-1">
                    <DropdownMenu.Item class="flex items-center gap-2 px-2.5 py-1.5 text-sm rounded hover:bg-ink/5 cursor-pointer">
                      <UserCircleIcon class="size-4" />
                      <span>Profile</span>
                    </DropdownMenu.Item>
                    <DropdownMenu.Item class="flex items-center gap-2 px-2.5 py-1.5 text-sm rounded hover:bg-ink/5 cursor-pointer">
                      <GearIcon class="size-4" />
                      <span>Settings</span>
                    </DropdownMenu.Item>
                    <div class="h-px bg-edge-muted my-1" />
                    <DropdownMenu.Item class="flex items-center gap-2 px-2.5 py-1.5 text-sm rounded hover:bg-ink/5 cursor-pointer text-failure">
                      <SignOutIcon class="size-4" />
                      <span>Sign out</span>
                    </DropdownMenu.Item>
                  </DropdownMenu.Content>
                </DropdownMenu.Portal>
              </DropdownMenu>
            </Show>
          </div>
        </header>

        {/* Main 2-column layout */}
        <div class="grid grid-cols-1 lg:grid-cols-[1.4fr_1fr] gap-6">
          {/* Left column: AI, Chats, Tasks, Recents, Drafts */}
          <div class="flex flex-col gap-6">
            <AISearchSection />
            <RecentChatsSection />
            <TasksSection />
            <RecentItemsSection />
            <DraftsSection />
          </div>

          {/* Right column: Team, Contacts, Activity */}
          <div class="flex flex-col gap-6">
            <TeamSection />
            <ContactsSection />
            <ActivitySection />
          </div>
        </div>
      </div>
    </main>
  );
}
