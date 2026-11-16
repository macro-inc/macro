import { useIncomingRuntimeRequestCount } from '@app/features/runtime-sharing/queries/pending-requests';
import { t } from '@app/lib/i18n';
import { Show } from 'solid-js';

/** How many access requests wait on the viewer's machines, beside Machines. */
export function MachinesRequestBadge() {
  const count = useIncomingRuntimeRequestCount();
  return (
    <Show when={count() > 0}>
      <span
        class="ml-auto flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-accent px-1 text-xxs font-medium leading-none text-surface touch:h-5 touch:min-w-5 touch:text-xs"
        aria-label={t('runtimeSharing.pendingRequests', { count: count() })}
        data-machines-request-badge
      >
        {count()}
      </span>
    </Show>
  );
}
