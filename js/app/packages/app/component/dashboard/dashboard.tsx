import {
  SplitHeaderLeft,
} from '@app/component/split-layout/components/SplitHeader';
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

      <div class="@container/dashboard relative">
        <div class="relative mx-auto max-w-4xl px-6 sm:px-8">
          <DashboardSideColumn />
        </div>

        <Hero />

        <div class="px-6 pb-10 sm:px-8">
          <div class="mx-auto max-w-4xl space-y-10">
            <TeamPulseSection />

            <RecentChannelsSection />

            <RecentSharedSection />

            <QuickLinksSection />

            <NotificationsSection />

            <section>
              <h2 class="mb-4 text-lg font-semibold tracking-tight text-ink">
                Priorities
              </h2>
              <div class="space-y-2">
                <div class="h-14 rounded-2xl border border-edge-muted bg-accent/5" />
                <div class="h-14 rounded-2xl border border-edge-muted bg-accent/5" />
                <div class="h-14 rounded-2xl border border-edge-muted bg-accent/5" />
              </div>
            </section>

            <section>
              <h2 class="mb-4 text-lg font-semibold tracking-tight text-ink">
                Today
              </h2>
              <div class="space-y-2">
                <div class="h-12 rounded-2xl border border-edge-muted bg-[#F8F3D9]" />
                <div class="h-12 rounded-2xl border border-edge-muted bg-[#F8F3D9]" />
                <div class="h-12 rounded-2xl border border-edge-muted bg-[#F8F3D9]" />
              </div>
            </section>
          </div>
        </div>
      </div>
    </main>
  );
}
