import { ViewShell } from '@app/components/view-shell';
import SquaresFourIcon from '@icon/system/regular/squares-four.svg';
import { DashboardBody } from './shared/dashboard-body';
import {
  type DashboardPageProps,
  dashboardPageTitle,
} from './shared/page-props';

/** Any dashboard opened by id, read-only and full width. */
export function DashboardPage(props: DashboardPageProps) {
  return (
    <div class="flex size-full min-h-0 min-w-0 flex-col text-ink">
      <ViewShell.TopBar class="gap-2">
        <SquaresFourIcon class="size-4 shrink-0 text-ink-muted" />
        <span class="min-w-0 truncate text-sm font-semibold">
          {dashboardPageTitle(props.dashboard())}
        </span>
      </ViewShell.TopBar>
      <div class="min-h-0 flex-1 overflow-y-auto">
        <div class="mx-auto flex min-h-full w-full max-w-6xl flex-col px-6 pt-4 pb-8">
          <DashboardBody view={props.dashboard} onRetry={props.onRetry} />
        </div>
      </div>
    </div>
  );
}
