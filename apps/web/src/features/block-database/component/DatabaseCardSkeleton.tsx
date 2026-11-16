import { ListSkeleton } from '@app/components/view-shell/ListSkeleton';
import { TableSkeleton } from '../../database/components/database-load-state';

/** The records area of an embedded database, at the height it loads into. */
export function DatabaseGridSkeleton() {
  return (
    <div class="flex h-96 min-h-0 flex-col border-t border-edge-muted">
      <TableSkeleton />
    </div>
  );
}

/**
 * An embedded database before its code loads, drawn like `DocumentDatabase`'s
 * card so the document does not move when it arrives.
 */
export function DatabaseCardSkeleton(props: { name: string }) {
  return (
    <section
      aria-label={`Database: ${props.name}`}
      class="my-2 flex min-w-0 flex-col overflow-hidden rounded-lg border border-edge-muted bg-panel text-ink"
    >
      <div class="flex min-w-0 items-center gap-2 px-3 py-2">
        <ListSkeleton.Bar class="size-4 shrink-0 rounded" />
        <span class="min-w-0 flex-1 truncate text-sm font-semibold">
          {props.name}
        </span>
        <ListSkeleton.Bar class="h-7 w-16 rounded-md" />
        <ListSkeleton.Bar class="h-7 w-20 rounded-md" />
      </div>
      <DatabaseGridSkeleton />
    </section>
  );
}
