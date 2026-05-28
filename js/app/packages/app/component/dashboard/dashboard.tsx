import { SplitHeaderLeft } from '@app/component/split-layout/components/SplitHeader';
import { TabsInset } from '@core/component/TabsInset';
import { DashboardSideColumn } from './dashboard-side-column';
import { Hero } from './sections/hero';
import { NotificationsSection } from './sections/notifications';
import { QuickLinksSection } from './sections/quick-links';
import { RecentChannelsSection } from './sections/recent-channels';
import { RecentSharedSection } from './sections/recent-shared';
import { TeamPulseSection } from './sections/team-pulse';

export function Dashboard() {
  return (
    <main class="relative h-full overflow-y-auto bg-surface">
      <SplitHeaderLeft>
        <div class="flex h-full items-center gap-3">
          <h1 class="text-base font-bold text-ink">Dashboard</h1>
          <TabsInset
            class="inline-flex h-auto"
            defaultValue="team"
            list={[
              { value: 'team', label: 'Team' },
              { value: 'individual', label: 'Individual' },
            ]}
          />
        </div>
      </SplitHeaderLeft>

      <div class="@container/dashboard px-6 pb-10 sm:px-8">
        <div class="grid grid-cols-1 gap-24 @6xl/dashboard:grid-cols-[minmax(0,1fr)_minmax(18rem,22rem)] @7xl/dashboard:grid-cols-[minmax(0,8rem)_minmax(0,1fr)_minmax(18rem,22rem)] @8xl/dashboard:grid-cols-[minmax(0,22rem)_minmax(0,1fr)_minmax(18rem,22rem)]">
          <div class="hidden @7xl/dashboard:block" />

          <div class="min-w-0 space-y-10 @6xl/dashboard:mx-0 @6xl/dashboard:max-w-none">
            <Hero />
            <TeamPulseSection />

            <RecentChannelsSection />

            <div class="@6xl/dashboard:hidden">
              <NotificationsSection />
            </div>

            <RecentSharedSection />

            <QuickLinksSection />
          </div>

          <DashboardSideColumn />
        </div>
      </div>
    </main>
  );
}
