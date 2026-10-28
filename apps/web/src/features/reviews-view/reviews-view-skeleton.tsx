import { ViewSkeleton } from '@app/components/view-shell/ViewSkeleton';

/** Reviews while its code loads: the scopes sidebar and the searchable list. */
export function ReviewsViewSkeleton() {
  return (
    <ViewSkeleton.Root asidePreferenceKey="reviews">
      <ViewSkeleton.Sidebar title="Reviews" createLabel="New" />
      <ViewSkeleton.Main
        title="Involves me"
        tabs={['• Open', '• Closed', '• All']}
        controls={[1, 2, 1, '+ New ⌄', 1]}
        searchPlaceholder="Search reviews"
      />
    </ViewSkeleton.Root>
  );
}
