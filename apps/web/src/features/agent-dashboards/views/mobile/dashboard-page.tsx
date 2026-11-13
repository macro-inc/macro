import { MobileHeader } from '@components/app/mobile-header/mobile-header';
import { DashboardBody } from '../shared/dashboard-body';
import {
  type DashboardPageProps,
  dashboardPageTitle,
} from '../shared/page-props';

/** A dashboard opened by id on touch: Back and its title, then one column. */
export function MobileDashboardPage(props: DashboardPageProps) {
  return (
    <div class="flex size-full min-h-0 min-w-0 flex-col text-ink">
      <MobileHeader>
        <MobileHeader.Title label={dashboardPageTitle(props.dashboard())} />
      </MobileHeader>
      <div class="min-h-0 flex-1 overflow-y-auto pt-[calc(var(--mobile-content-inset-top,0px)+0.5rem)] pb-[calc(var(--mobile-content-inset-bottom,0px)+1rem)]">
        <div class="flex min-h-full flex-col px-(--mobile-chrome-gutter)">
          <DashboardBody view={props.dashboard} onRetry={props.onRetry} />
        </div>
      </div>
    </div>
  );
}
