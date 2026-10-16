import { ViewSkeleton } from '@app/components/view-shell/ViewSkeleton';

/** Chat while its code loads: the conversation list and the empty main area. */
export function ChannelsViewSkeleton() {
  return (
    <ViewSkeleton.Root asidePreferenceKey="channels">
      <ViewSkeleton.Sidebar title="Chat" />
      <ViewSkeleton.Main title="Chat">
        <div class="flex flex-1 items-center justify-center text-ink-muted text-sm">
          Select a conversation
        </div>
      </ViewSkeleton.Main>
    </ViewSkeleton.Root>
  );
}
