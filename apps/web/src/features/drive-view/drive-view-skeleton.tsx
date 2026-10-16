import { ViewSkeleton } from '@app/components/view-shell/ViewSkeleton';

/** Drive while its code loads: the folders sidebar and the searchable file list. */
export function DriveViewSkeleton() {
  return (
    <ViewSkeleton.Root asidePreferenceKey="documents">
      <ViewSkeleton.Sidebar title="Drive" createLabel="New" />
      <ViewSkeleton.Main title="Drive" searchPlaceholder="Search files" />
    </ViewSkeleton.Root>
  );
}
