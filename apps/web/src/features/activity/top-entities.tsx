import { SoupSectionHeader } from '@app/features/next-soup/soup-view/section-header';
import { openDocument } from '@core/component/LexicalMarkdown/component/core/BlockLink';
import { useSplitNavigationHandler } from '@core/util/useSplitNavigationHandler';
import { usePropertyEntityDisplay } from '@property/hooks';
import type { ActivityOverview } from '@queries/activity/graphql/overview';
import type { EntityType } from '@service-properties/generated/schemas/entityType';
import { For, Show } from 'solid-js';
import { displayEntityType } from './display-entity-type';
import { EntityMention } from './entity-mention';

type EntityRank = ActivityOverview['topEntities'][number];

const ROW_CLASS = 'mx-1 flex w-[calc(100%-0.5rem)] items-stretch px-2 text-sm';
const ROW_BODY_CLASS =
  'flex min-h-10 min-w-0 flex-1 items-center gap-1.5 rounded-lg px-2 py-0.5 hover:bg-hover/30';

/**
 * The entities the viewer touched most, as a list that shares the activity
 * feed's row chrome — mention on the left, action count on the right.
 */
export function TopEntities(props: {
  entities: ActivityOverview['topEntities'];
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
          {(entity) => <TopEntityRow entity={entity} />}
        </For>
      </Show>
    </section>
  );
}

function TopEntityRow(props: { entity: EntityRank }) {
  const displayType = () => displayEntityType(props.entity.entityType);

  return (
    <div class={ROW_CLASS}>
      <Show
        when={displayType()}
        fallback={
          <div class={ROW_BODY_CLASS}>
            <span class="min-w-0 truncate text-ink-extra-muted">
              {props.entity.entityType}
            </span>
            <ActionCount count={props.entity.count} />
          </div>
        }
      >
        {(type) => (
          <MappedEntityRow entity={props.entity} entityType={type()} />
        )}
      </Show>
    </div>
  );
}

function MappedEntityRow(props: {
  entity: EntityRank;
  entityType: EntityType;
}) {
  const display = usePropertyEntityDisplay(
    () => props.entity.entityId,
    () => props.entityType
  );
  const navHandlers = useSplitNavigationHandler<HTMLDivElement>((event) => {
    const block = display.blockOrFileType();
    if (!block) return;
    openDocument(
      block,
      props.entity.entityId,
      display.linkParams(),
      event.shiftKey
    );
  });

  return (
    <div {...navHandlers} class={ROW_BODY_CLASS}>
      <span class="min-w-0 truncate">
        <EntityMention entityId={props.entity.entityId} display={display} />
      </span>
      <ActionCount count={props.entity.count} />
    </div>
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
