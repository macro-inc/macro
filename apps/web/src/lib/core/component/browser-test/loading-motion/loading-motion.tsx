import '@app/index.css';
import '@app/features/calendar/calendar.css';
import { ListSkeleton } from '@app/components/view-shell/ListSkeleton';
import { LoadingSpinner } from '@core/component/LoadingSpinner';
import { getPlatform } from '@core/util/platform';
import { Spinner } from '@ui';
import { render } from 'solid-js/web';

// As `index.tsx` does; the test stands in for the native bridge first.
document.documentElement.dataset.platform = getPlatform();

/** The app's loading indicators, each marked for the test to find. */
function Fixture() {
  return (
    <div class="flex flex-col gap-4 p-4">
      <div data-testid="shimmer">
        <ListSkeleton.Bar class="w-40" />
      </div>
      <Spinner label="Loading" />
      <div class="h-1 w-40 overflow-hidden">
        <div
          data-testid="indeterminate"
          class="h-full w-2/5 rounded-full bg-accent animate-indeterminate-bar"
        />
      </div>
      <div class="calendar-view">
        <div
          data-testid="calendar"
          data-calendar-loading-placeholder
          class="h-4 w-40 bg-skeleton"
        />
      </div>
      <div data-testid="brand">
        <LoadingSpinner />
      </div>
    </div>
  );
}

const root = document.getElementById('root');
if (root) render(() => <Fixture />, root);
