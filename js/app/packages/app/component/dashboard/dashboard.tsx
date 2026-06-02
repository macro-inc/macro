import { DashboardSectionBoundary } from '@app/component/dashboard/dashboard-section-boundary';
import { Hero } from '@app/component/dashboard/sections/hero';

export function Dashboard() {
  return (
    <main class="relative h-full overflow-y-auto bg-surface">
      <div class="@container/dashboard size-full px-0 pb-10 p-2 md:p-4">
        <div class="mx-auto h-full flex flex-col justify-center -mt-15 w-full min-w-0 max-w-2xl gap-10">
          <DashboardSectionBoundary title="hero">
            <Hero />
          </DashboardSectionBoundary>
        </div>
      </div>
    </main>
  );
}
