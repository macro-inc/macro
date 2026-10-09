import { ViewSkeleton } from '@app/components/view-shell/ViewSkeleton';

/** Reviews while its code loads: the scopes sidebar and the searchable list. */
export function ReviewsViewSkeleton() {
  return (
    <ViewSkeleton.Root asidePreferenceKey="reviews">
      <ViewSkeleton.Sidebar title="Reviews" />
      <ViewSkeleton.Main title="Reviews" searchPlaceholder="Search reviews" />
    </ViewSkeleton.Root>
  );
}
