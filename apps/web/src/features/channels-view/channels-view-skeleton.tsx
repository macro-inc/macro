import { ViewSkeleton } from '@app/components/view-shell/ViewSkeleton';
import { For } from 'solid-js';

/** Chat while its code loads: the conversation list and the empty main area. */
export function ChannelsViewSkeleton() {
  return (
    <ViewSkeleton.Root asidePreferenceKey="channels">
      <ViewSkeleton.Sidebar title="Chat" createLabel="New">
        <div class="flex gap-1.5 px-(--sidebar-gutter) pt-2 touch:hidden">
          <For each={['All', 'Recent', 'Threads']}>
            {(tab) => <ViewSkeleton.Control control={tab} class="flex-1" />}
          </For>
        </div>
        <ViewSkeleton.Rows label="Loading Chat" class="mt-3" />
      </ViewSkeleton.Sidebar>
      <ViewSkeleton.Main title="Chat">
        <div class="flex flex-1 items-center justify-center text-ink-muted text-sm">
          Select a conversation
        </div>
      </ViewSkeleton.Main>
    </ViewSkeleton.Root>
  );
}
