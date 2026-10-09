import { ViewSkeleton } from '@app/components/view-shell/ViewSkeleton';

/** Agents while its code loads: the conversations sidebar and a new conversation. */
export function AgentsViewSkeleton() {
  return (
    <ViewSkeleton.Root
      asidePreferenceKey="agents"
      aside={{ min: 224, max: 380, preserveDuringResize: false }}
      main={{ min: 280, preferredWidth: 640 }}
    >
      <ViewSkeleton.Sidebar title="Agents" createLabel="New conversation" />
      <ViewSkeleton.Main title="New conversation">
        <div class="flex-1" />
      </ViewSkeleton.Main>
    </ViewSkeleton.Root>
  );
}
