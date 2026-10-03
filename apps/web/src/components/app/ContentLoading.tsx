import { LoadingSpinner } from '@core/component/LoadingSpinner';

/** Visible immediately, even when the surrounding mobile chrome is hidden. */
export function ContentLoading() {
  return (
    <div
      role="status"
      aria-label="Loading"
      class="flex size-full min-h-24 items-center justify-center"
    >
      <LoadingSpinner />
    </div>
  );
}
