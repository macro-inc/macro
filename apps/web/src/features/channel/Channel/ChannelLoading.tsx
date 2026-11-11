import { LoadingSpinner } from '@core/component/LoadingSpinner';

/** Shared Macro loader for target resolution and message loading. */
export function ChannelLoading() {
  return (
    <div
      role="status"
      aria-label="Loading conversation"
      class="flex min-h-0 flex-1 flex-col items-center justify-center overflow-hidden px-5 py-6 touch:pt-(--mobile-content-inset-top) touch:pb-(--mobile-content-inset-bottom)"
    >
      <span class="sr-only">Loading conversation</span>
      <div aria-hidden="true">
        <LoadingSpinner />
      </div>
    </div>
  );
}
