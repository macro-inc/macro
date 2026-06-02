import { Hero } from '@app/component/dashboard/sections/hero';
import { RecentConversationsSection } from '@app/component/dashboard/sections/recent-conversations';
import { TeamPulseSection } from '@app/component/dashboard/sections/team-pulse';
import { DashboardSectionBoundary } from './dashboard-section-boundary';

export function CenteredView() {
  return (
    <div class="grid grid-cols-1 gap-24 ">
      <div class="hidden @7xl/dashboard:block" />

      <div class="mx-auto flex w-full min-w-0 max-w-2xl flex-col gap-10">
        <div class="@md:pt-[60cqh] @sm:pt-[10cqh] pt-4 @md:-translate-y-[30vh] flex flex-col gap-24 sm:px-0">
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
        </div>
      </div>
    </div>
  );
}
