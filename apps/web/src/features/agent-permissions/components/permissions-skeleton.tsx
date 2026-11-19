import { ListSkeleton } from '@app/components/view-shell/ListSkeleton';
import { t } from '@app/lib/i18n';
import { For } from 'solid-js';

/** Group rows' geometry while permissions load. */
export function PermissionsSkeleton() {
  return (
    <ListSkeleton.Root label={t('agentPermissions.loading')}>
      <For each={[0.32, 0.5, 0.24, 0.4, 0.28, 0.44]}>
        {(width) => (
          <div class="flex min-h-16 items-center gap-3 px-4 py-3">
            <div class="skeleton-shimmer size-8 shrink-0 rounded-lg bg-skeleton" />
            <div class="flex flex-1 flex-col gap-2">
              <ListSkeleton.Bar class="h-3 w-28" />
              <div style={{ width: `${width * 100}%` }}>
                <ListSkeleton.Bar class="h-2.5 w-full" />
              </div>
            </div>
          </div>
        )}
      </For>
    </ListSkeleton.Root>
  );
}
