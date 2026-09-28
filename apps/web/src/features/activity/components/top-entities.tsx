import { SoupSectionHeader } from '@app/features/next-soup/soup-view/section-header';
import { type JSX, Show } from 'solid-js';
import type { EntityDisplay } from '../context/activity-context';
import type { ActivityTopEntity } from '../core/event';

/**
 * The "Most active" chips as one wrapping row under the graph card, headed
 * like the feed's day sections. The view supplies the chips and hides the
 * section when there are none.
 */
export function TopEntitiesSection(props: { children: JSX.Element }) {
  return (
    <section
      class="flex min-w-0 flex-col gap-1.5"
      aria-labelledby="activity-most-active-heading"
    >
      <SoupSectionHeader class="mx-0 my-0 w-full">
        <h2 id="activity-most-active-heading">Most active</h2>
      </SoupSectionHeader>
      <div class="flex min-w-0 flex-wrap items-center gap-1.5 px-1">
        {props.children}
      </div>
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
            <span class="max-w-[24ch] truncate text-ink @max-md/u-list:max-w-[16ch]">
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
