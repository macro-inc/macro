import { CenteredView } from '@app/component/dashboard/centered-view';
import { SplitHeaderLeft } from '@app/component/split-layout/components/SplitHeader';

export function Dashboard() {
  return (
    <main class="relative h-full overflow-y-auto bg-surface">
      <SplitHeaderLeft>
        <div class="flex h-full items-center gap-3">
          <h1 class="text-base font-bold text-ink">Dashboard</h1>
        </div>
      </SplitHeaderLeft>

      <div class="@container/dashboard size-full px-0 pb-10 sm:p-8">
        <CenteredView />
      </div>
    </main>
  );
}
