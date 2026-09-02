import { SoupSectionHeader } from '@app/features/next-soup/soup-view/section-header';
import type { EntityType } from '@service-properties/generated/schemas/entityType';
import { type Component, For, type JSX, Show } from 'solid-js';
import type { ActivityTopEntity } from '../core/event';
import { toPropertyEntityType } from '../core/event';
import type { EntityDisplay } from './entity-mention';
import { EntityMention } from './entity-mention';

function Row(props: { children: JSX.Element }) {
  return (
    <div class="mx-1 flex w-[calc(100%-0.5rem)] items-stretch px-2 text-sm">
      {props.children}
    </div>
  );
}

function RowBody(props: JSX.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      {...props}
      class="flex min-h-10 min-w-0 flex-1 items-center gap-1.5 rounded-lg px-2 py-0.5 hover:bg-hover/30"
    />
  );
}

/**
 * The entities the viewer touched most, as a list that shares the activity
 * feed's row chrome — mention on the left, action count on the right.
 */
export function TopEntities(props: {
  entities: ActivityTopEntity[];
  mappedRow: Component<{
    entity: ActivityTopEntity;
    entityType: EntityType;
  }>;
}) {
  return (
    <section class="min-w-0" aria-label="Most active">
      <SoupSectionHeader>Most active</SoupSectionHeader>
      <Show
        when={props.entities.length > 0}
        fallback={
          <p class="px-2 py-2 text-ink-muted text-sm">No entities yet.</p>
        }
      >
        <For each={props.entities}>
          {(entity) => (
            <TopEntityRow entity={entity} mappedRow={props.mappedRow} />
          )}
        </For>
      </Show>
    </section>
  );
}

function TopEntityRow(props: {
  entity: ActivityTopEntity;
  mappedRow: Component<{
    entity: ActivityTopEntity;
    entityType: EntityType;
  }>;
}) {
  const displayType = () => toPropertyEntityType(props.entity.entityType);

  return (
    <Row>
      <Show
        when={displayType()}
        fallback={
          <RowBody>
            <span class="min-w-0 truncate text-ink-extra-muted">Item</span>
            <ActionCount count={props.entity.count} />
          </RowBody>
        }
      >
        {(type) => (
          <props.mappedRow entity={props.entity} entityType={type()} />
        )}
      </Show>
    </Row>
  );
}

export function TopEntityBody(props: {
  entity: ActivityTopEntity;
  display: EntityDisplay;
  rowProps?: JSX.HTMLAttributes<HTMLDivElement>;
}) {
  return (
    <RowBody {...props.rowProps}>
      <span class="min-w-0 truncate">
        <EntityMention
          entityId={props.entity.entityId}
          display={props.display}
        />
      </span>
      <ActionCount count={props.entity.count} />
    </RowBody>
  );
}

function ActionCount(props: { count: number }) {
  const noun = () => (props.count === 1 ? 'action' : 'actions');
  return (
    <span class="ml-auto shrink-0 text-right font-medium text-ink-extra-muted text-xs tabular-nums">
      {props.count.toLocaleString()} {noun()}
    </span>
  );
}
