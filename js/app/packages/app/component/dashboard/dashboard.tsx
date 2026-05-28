import { AutomationsSection } from './sections/automations';
import { Hero } from './sections/hero';
import { NotificationsSection } from './sections/notifications';
import { QuickLinksSection } from './sections/quick-links';
import { RecentChannelsSection } from './sections/recent-channels';
import { RecentSharedSection } from './sections/recent-shared';
import { TeamMembersSection } from './sections/team-members';

export function Dashboard() {
  return (
    <main class="relative h-full overflow-y-auto bg-surface">
      <Hero />

      <div class="@container/dashboard px-6 pb-10 sm:px-8">
        <div class="grid w-full gap-x-8 gap-y-10 @6xl/dashboard:grid-cols-[minmax(0,1fr)_24rem]">
          <div class="space-y-10">
            <QuickLinksSection />

            <RecentChannelsSection />

            <RecentSharedSection />

            <AutomationsSection />
          </div>

          <aside class="space-y-8">
            <NotificationsSection />

            <TeamMembersSection />

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
          </aside>
        </div>
      </div>
    </main>
  );
}
