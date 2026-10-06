/** Shared by preview cards and their async boundaries; no document data required. */
export function DocumentPreviewIconSkeleton(props: { label?: string }) {
  return (
    <span
      role={props.label ? 'img' : undefined}
      aria-label={props.label}
      aria-hidden={props.label ? undefined : true}
      class="block size-4 shrink-0 rounded-full bg-skeleton motion-safe:animate-pulse"
    />
  );
}

export function DocumentPreviewSkeleton() {
  return (
    <div
      role="status"
      aria-label="Loading document preview"
      class="w-full px-3 py-2.5"
    >
      <div
        aria-hidden="true"
        class="grid grid-cols-[1rem_minmax(0,1fr)] items-start gap-x-2"
      >
        <div class="pt-0.5">
          <DocumentPreviewIconSkeleton />
        </div>
        <div class="flex min-w-0 flex-col gap-2 py-1 motion-safe:animate-pulse">
          <div class="h-3.5 w-3/4 rounded bg-skeleton" />
          <div class="h-3.5 w-1/2 rounded bg-skeleton" />
        </div>
      </div>
    </div>
  );
}
