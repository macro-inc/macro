import { Hero } from '@app/component/dashboard/sections/hero';
import { NotificationsSection } from '@app/component/dashboard/sections/notifications';
import { QuickLinksSection } from '@app/component/dashboard/sections/quick-links';
import { RecentConversationsSection } from '@app/component/dashboard/sections/recent-conversations';
import { RecentSharedSection } from '@app/component/dashboard/sections/recent-shared';
import { TeamPulseSection } from '@app/component/dashboard/sections/team-pulse';
import { DashboardSectionBoundary } from './dashboard-section-boundary';

export function CenteredView() {
  return (
    <div class="grid grid-cols-1 gap-24 ">
      <div class="hidden @7xl/dashboard:block" />

      <div class="mx-auto flex w-full min-w-0 max-w-2xl flex-col gap-10">
        <div class="@md:pt-[50vh] @md:-translate-y-[30vh] flex flex-col gap-24 px-4 sm:px-0">
          <DashboardSectionBoundary title="hero">
            <Hero />
          </DashboardSectionBoundary>

          <DashboardSectionBoundary title="team pulse">
            <TeamPulseSection />
          </DashboardSectionBoundary>

          <div>
            <DashboardSectionBoundary title="recent conversations">
              <RecentConversationsSection />
            </DashboardSectionBoundary>
          </div>

          {/* <div class="hidden px-4 sm:block sm:px-0"> */}
          {/*   <DashboardSectionBoundary title="notifications"> */}
          {/*     <NotificationsSection /> */}
          {/*   </DashboardSectionBoundary> */}
          {/* </div> */}

          {/* <div class="px-4 sm:px-0"> */}
          {/*   <DashboardSectionBoundary title="recent and shared"> */}
          {/*     <RecentSharedSection /> */}
          {/*   </DashboardSectionBoundary> */}
          {/* </div> */}
        </div>
      </div>
    </div>
  );
}
