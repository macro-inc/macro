import { ViewSkeleton } from '@app/components/view-shell/ViewSkeleton';

/** Email while its code loads: the inbox sidebar and the searchable list. */
export function EmailViewSkeleton() {
  return (
    <ViewSkeleton.Root asidePreferenceKey="email">
      <ViewSkeleton.Sidebar title="Email" createLabel="New email" />
      <ViewSkeleton.Main
        title="Inbox"
        tabs={['Signal', 'Noise']}
        controls={[2, 1, '+ New', 1]}
        searchPlaceholder="Search email"
      />
    </ViewSkeleton.Root>
  );
}
