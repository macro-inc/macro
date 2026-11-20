import { ListSkeleton } from '@app/components/view-shell/ListSkeleton';
import { t } from '@app/lib/i18n';
import { For } from 'solid-js';

/** The list while its first page loads: a date divider, then cards. */
export function InboxListSkeleton() {
  return (
    <ListSkeleton.Root
      label={t('notificationsInbox.loading')}
      class="touch:pt-(--mobile-content-inset-top)"
    >
      <div class="flex h-7 items-center pr-4 pl-6 mobile:pl-7">
        <ListSkeleton.Bar class="h-2 w-16" />
      </div>
      <For each={[0, 1, 2, 3, 4]}>
        {() => (
          <ListSkeleton.Row class="h-[81px] items-start gap-3 py-3 pr-4 pl-6 touch:h-[81px] mobile:h-[87px] mobile:pl-7">
            <ListSkeleton.Bar class="size-6 shrink-0 rounded-full mobile:size-10" />
            <div class="flex min-w-0 flex-1 flex-col gap-2">
              <ListSkeleton.Bar class="w-1/3" />
              <ListSkeleton.Bar class="w-1/2" />
              <ListSkeleton.Bar class="w-4/5" />
            </div>
          </ListSkeleton.Row>
        )}
      </For>
    </ListSkeleton.Root>
  );
}
