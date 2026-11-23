import { ListSkeleton } from '@app/components/view-shell/ListSkeleton';
import { t } from '@app/lib/i18n';
import { For } from 'solid-js';

/** The Tool permissions table's five action rows while they load. */
export function PermissionsSkeleton() {
  return (
    <ListSkeleton.Root label={t('agentPermissions.loading')}>
      <div class="flex flex-col rounded-2xl border border-edge-muted px-4.5 pt-2 pb-3">
        <div class="flex h-8.5 items-center border-b border-edge-muted">
          <ListSkeleton.Bar class="h-2.5 w-14" />
        </div>
        <For each={['w-10', 'w-14', 'w-9', 'w-10', 'w-12']}>
          {(width) => (
            <div class="flex h-12 items-center gap-3">
              <div class="flex-1">
                <ListSkeleton.Bar class={`h-3 ${width}`} />
              </div>
              <ListSkeleton.Bar class="h-8 w-44 shrink-0 rounded-full" />
            </div>
          )}
        </For>
      </div>
    </ListSkeleton.Root>
  );
}
