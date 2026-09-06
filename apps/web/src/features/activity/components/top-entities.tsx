import { type JSX, Show } from 'solid-js';
import type { EntityDisplay } from '../context/activity-context';
import type { ActivityTopEntity } from '../core/event';

/**
 * The "Most active" chips as one wrapping row under the graph card, with a
 * muted lead-in label. The view supplies the chips and hides the row when
 * there are none.
 */
export function TopEntitiesSection(props: { children: JSX.Element }) {
  return (
    <section
      class="flex min-w-0 flex-wrap items-center gap-1.5 px-1"
      aria-label="Most active"
    >
      <span class="mr-0.5 shrink-0 text-ink-extra-muted text-xs">
        Most active
      </span>
      {props.children}
    </section>
  );
}

/**
 * One most-active entity as a pill: icon, name, action count. Without a
 * resolved display the entity kind is not linkable and the chip reads
 * "Item". `rowProps` carry the host's click-to-open handlers.
 */
export function TopEntityChip(props: {
  entity: ActivityTopEntity;
  display?: EntityDisplay;
  rowProps?: JSX.HTMLAttributes<HTMLDivElement>;
}) {
  return (
    <div
      {...props.rowProps}
      class="inline-flex max-w-full cursor-default items-center gap-1.5 rounded-full border border-edge-muted bg-surface px-2.5 py-1 text-xs hover:bg-hover/30"
      data-activity-top-entity
    >
      <Show
        when={props.display}
        fallback={<span class="text-ink-extra-muted">Item</span>}
      >
        {(display) => (
          <>
            <span class="flex shrink-0 items-center [&_svg]:size-3.5">
              {display().icon()}
            </span>
            <span class="max-w-[24ch] truncate text-ink">
              {display().name()}
            </span>
          </>
        )}
      </Show>
      <span class="shrink-0 text-ink-extra-muted tabular-nums">
        {props.entity.count.toLocaleString()}
      </span>
    </div>
  );
}
