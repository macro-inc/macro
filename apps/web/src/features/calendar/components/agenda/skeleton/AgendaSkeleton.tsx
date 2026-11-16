import { ListSkeleton } from '@app/components/view-shell/ListSkeleton';
import { t } from '@app/lib/i18n';
import { For } from 'solid-js';

/** Keeps an Agenda loading route in list form rather than flashing a week grid. */
export function AgendaSkeleton() {
  return (
    <ListSkeleton.Root
      label={t('common.loading')}
      class="w-full max-w-2xl space-y-6 p-5"
    >
      <For each={[0, 1, 2]}>
        {() => (
          <div class="space-y-3">
            <ListSkeleton.Bar class="w-24" />
            <For each={[0, 1]}>
              {() => (
                <ListSkeleton.Row>
                  <ListSkeleton.Bar class="w-10" />
                  <ListSkeleton.Bar class="w-1/2" />
                </ListSkeleton.Row>
              )}
            </For>
          </div>
        )}
      </For>
    </ListSkeleton.Root>
  );
}
