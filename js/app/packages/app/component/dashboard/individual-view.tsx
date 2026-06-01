import { DashboardSideColumn } from '@app/component/dashboard/dashboard-side-column';
import { Hero } from '@app/component/dashboard/sections/hero';
import { NotificationsSection } from '@app/component/dashboard/sections/notifications';
import { QuickLinksSection } from '@app/component/dashboard/sections/quick-links';
import { RecentConversationsSection } from '@app/component/dashboard/sections/recent-conversations';
import { RecentSharedSection } from '@app/component/dashboard/sections/recent-shared';
import { DashboardSectionBoundary } from './dashboard-section-boundary';

export function IndividualView() {
  return (
    <div class="grid grid-cols-1 gap-24 @6xl/dashboard:grid-cols-[minmax(0,1fr)_minmax(22rem,26rem)] @7xl/dashboard:grid-cols-[minmax(0,8rem)_minmax(0,1fr)_minmax(22rem,26rem)] @8xl/dashboard:grid-cols-[minmax(0,22rem)_minmax(0,1fr)_minmax(22rem,26rem)]">
      <div class="hidden @7xl/dashboard:block" />

      <div class="mx-auto flex w-full min-w-0 max-w-3xl flex-col gap-10 @6xl/dashboard:mx-auto">
        <div class="px-4 sm:px-0">
          <DashboardSectionBoundary title="hero">
            <Hero />
          </DashboardSectionBoundary>
        </div>

        {/* <DashboardSectionBoundary title="team pulse"> */}
        {/*   <TeamPulseSection /> */}
        {/* </DashboardSectionBoundary> */}

        <div class="@6xl/dashboard:hidden">
          <DashboardSectionBoundary title="recent conversations">
            <RecentConversationsSection />
          </DashboardSectionBoundary>
        </div>

        <div class="hidden px-4 sm:block sm:px-0 @6xl/dashboard:hidden">
          <DashboardSectionBoundary title="notifications">
            <NotificationsSection />
          </DashboardSectionBoundary>
        </div>

        <div class="px-4 sm:px-0">
          <DashboardSectionBoundary title="recent and shared">
            <RecentSharedSection />
          </DashboardSectionBoundary>
        </div>

        <div class="px-4 sm:px-0 @6xl/dashboard:hidden">
          <DashboardSectionBoundary title="quick links">
            <QuickLinksSection />
          </DashboardSectionBoundary>
        </div>
      </div>

      <DashboardSideColumn />
    </div>
  );
}
