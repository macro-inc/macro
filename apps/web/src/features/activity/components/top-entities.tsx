import { SoupSectionHeader } from '@app/features/next-soup/soup-view/section-header';
import { type JSX, Show } from 'solid-js';
import type { EntityDisplay } from '../context/activity-context';
import type { ActivityTopEntity } from '../core/event';
import { EntityMention } from './entity-mention';

/** The "Most active" section chrome; the view supplies the rows. */
export function TopEntitiesSection(props: {
  empty: boolean;
  children: JSX.Element;
}) {
  return (
    <section class="min-w-0" aria-label="Most active">
      <SoupSectionHeader>Most active</SoupSectionHeader>
      <Show
        when={!props.empty}
        fallback={
          <p class="px-2 py-2 text-ink-muted text-sm">No entities yet.</p>
        }
      >
        {props.children}
      </Show>
    </section>
  );
}

/**
 * One most-active row sharing the feed's row chrome: mention on the left,
 * action count on the right. Without a resolved display the entity kind is
 * not linkable and the row reads "Item".
 */
export function TopEntityRow(props: {
  entity: ActivityTopEntity;
  display?: EntityDisplay;
  rowProps?: JSX.HTMLAttributes<HTMLDivElement>;
}) {
  return (
    <div class="mx-1 flex w-[calc(100%-0.5rem)] items-stretch px-2 text-sm">
      <div
        {...props.rowProps}
        class="flex min-h-10 min-w-0 flex-1 items-center gap-1.5 rounded-lg px-2 py-0.5 hover:bg-hover/30"
      >
        <span class="min-w-0 truncate">
          <Show
            when={props.display}
            fallback={<span class="text-ink-extra-muted">Item</span>}
          >
            {(display) => (
              <EntityMention
                entityId={props.entity.entityId}
                display={display()}
              />
            )}
          </Show>
        </span>
        <span class="ml-auto shrink-0 text-right font-medium text-ink-extra-muted text-xs tabular-nums">
          {props.entity.count.toLocaleString()}{' '}
          {props.entity.count === 1 ? 'action' : 'actions'}
        </span>
      </div>
    </div>
  );
}
