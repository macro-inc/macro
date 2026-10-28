import {
  CollectionCard,
  CollectionGroup,
} from '@app/features/agent-cards/components/collection';
import {
  compileToAst,
  defineQueryFilters,
  type Query,
  queryStateFrom,
} from '@app/features/next-soup/filters/filter-store';
import type { FieldFilters } from '@app/features/next-soup/filters/filter-store/types';
import { soupItemMatchesQuery } from '@app/features/next-soup/filters/query-filters';
import { openEntityInSplitFromUnifiedList } from '@app/features/next-soup/utils';
import { withEntityNotifications } from '@app/features/soup/entity-notifications';
import { useGlobalNotificationSource } from '@components/app/GlobalAppState';
import type { EntityIconSelector } from '@core/component/EntityIcon';
import { ListEntityMetadataQueryProvider } from '@entity';
import { ListEntity, ListLayoutProvider } from '@entity/composed/ListEntity';
import type { EntityData } from '@entity/types/entity';
import type { WithNotification } from '@entity/types/notification';
import type { GroupByField, GroupMeta } from '@queries/soup/grouped/types';
import {
  type SoupApiItemFilter,
  type SoupAstItemsQueryArgs,
  useSoupAstItemsQuery,
} from '@queries/soup/items';
import { createMemo, For, Show, Suspense } from 'solid-js';
import type { EntityRef, WidgetOf } from '../schema';

/**
 * A list of workspace items, as an agent collection card: a header with the
 * title and count, the rows, group headers when grouped, and a fixed height
 * with "N more below" once the list is long.
 *
 * ── Real unified-list rows ───────────────────────────────────────────────────
 * Rows render via {@link ListEntity} — the very same component the soup list uses
 * — so each row shows icon + title + meta + timestamp and, for TASKS, the live
 * status / priority / assignee pills (`Entity.Properties` inside the wide layout).
 *
 * `ListEntity` takes a full `EntityData` (not a bare `{ id, type }` ref) and the
 * task pills read `entity.properties`. Both come from the soup item query: we
 * compile the widget's source into a soup AST and let `useSoupAstItemsQuery`
 * return ready-to-render `EntityData[]` (properties pre-attached). The only
 * composition root supplies responsive layout and shared row metadata; leaf
 * rows remain query-free. `Entity.Properties` brings its own
 * `PropertiesProvider`, and the split-panel / soup-view contexts are optional.
 *
 *  - `items` mode: resolve the supplied refs → EntityData via an id-filtered AST.
 *  - `query` mode: drive the same query straight from `source.query`.
 */

export type ListProps = Omit<WidgetOf<'list'>, 'type'>;

/** The `FieldFilters` keys whose value is a `string[]` id list. */
type IdFieldName = {
  [K in keyof FieldFilters]: FieldFilters[K] extends string[] | undefined
    ? K
    : never;
}[keyof FieldFilters];

/**
 * Map a schema `EntityRef.type` onto the soup `FieldFilters` id field.
 *
 * Both `email` and `email_thread` are mapped here: `EntityData`/`ListEntities`
 * tag emails as `'email'` everywhere else in the app (see
 * `@entity/types/entity`'s `EmailEntity`), so that's what the AI actually
 * echoes back from prior tool results into a `list` widget's refs, but
 * `email_thread` is also a legal `EntityType` value (see `@core/types`) —
 * keep both so neither spelling gets silently dropped.
 */
const ID_FIELD_BY_TYPE: Partial<Record<EntityRef['type'], IdFieldName>> = {
  document: 'documentId',
  chat: 'chatId',
  channel: 'channelId',
  project: 'folderId',
  email: 'threadId',
  email_thread: 'threadId',
  call: 'callId',
  foreign_entity: 'foreignEntityRecordId',
  crm_company: 'crmCompanyId',
  calendar_event: 'calendarEventId',
  // user / team / crm_contact / static_file have no soup item filter — skipped.
};

/** Build a soup `Query` that fetches exactly the given refs by id. */
function refsToQuery(refs: EntityRef[]): Query {
  const include: FieldFilters = {};
  for (const ref of refs) {
    const field = ID_FIELD_BY_TYPE[ref.type];
    if (!field) continue;
    include[field] ??= [];
    (include[field] as string[]).push(ref.id);
  }
  return { include };
}

/** Compile a widget `Query` into the soup AST body the items query expects. */
function compileQuery(query: Query): SoupAstItemsQueryArgs['body'] {
  // `defineQueryFilters` NIL-fills the entity targets the query doesn't
  // reference, so soup doesn't fan out and fetch every document/channel/etc.
  return compileToAst(queryStateFrom(defineQueryFilters(query)));
}

const GROUP_BY_BY_NAME: Record<
  NonNullable<ListProps['groupBy']>,
  GroupByField
> = {
  date: { type: 'date' },
  entity_type: { type: 'entity_type' },
  project: { type: 'project' },
};

// Cached query meta outlives the widget; the gate closes over the plain query
// snapshot only, never the component scope.
function queryItemFilter(source: Query): SoupApiItemFilter {
  return (item) => soupItemMatchesQuery(item, source);
}

/**
 * One row: a real `ListEntity`, rendered flush the way SoupView / the unified
 * list do. The row's own `Entity.Root` supplies its height, the rounded inset
 * `bg-hover/30` highlight pill (`w-[calc(100%-0.5rem)] mx-1`), and hover state —
 * so it must sit in a flush container, NOT a bordered/`divide-y` card, or the
 * pill ends up boxed in by per-row dividers. `hideCheckbox` drops the
 * multi-select checkbox (read-only embed), leaving just the icon / unread dot.
 *
 * Clicking opens the entity in a split, exactly like the real unified list
 * (`soup-view.tsx`) and the other standalone `ListEntity` embeds (e.g.
 * `ContactEmailsSection`) — via `openEntityInSplitFromUnifiedList`, which
 * dispatches per `entity.type` and works for every type here already,
 * `email` included.
 */
function Row(props: { entity: WithNotification<EntityData> }) {
  const notificationSource = useGlobalNotificationSource();
  return (
    <div data-card-row class="min-w-0">
      <ListEntity
        entity={props.entity}
        hideCheckbox
        onClick={() =>
          openEntityInSplitFromUnifiedList(props.entity, {
            notificationSource,
          })
        }
      />
    </div>
  );
}

/** The icon a collection's header takes: the rows' own kind, or a mix. */
function collectionIcon(entities: readonly EntityData[]): EntityIconSelector {
  const kind = entities[0]?.type;
  if (!kind || entities.some((entity) => entity.type !== kind)) return 'files';
  return kind as EntityIconSelector;
}

type Section = { label?: string; entities: WithNotification<EntityData>[] };

/**
 * The rows in the order the query grouped them, each group under its
 * label. Rows the groups do not name close the list unlabeled, so nothing
 * the query returned goes missing.
 */
function sections(
  entities: WithNotification<EntityData>[],
  groups: readonly GroupMeta[] | undefined
): Section[] {
  if (!groups?.length) return [{ entities }];
  const byId = new Map(entities.map((entity) => [entity.id, entity]));
  const placed = new Set<string>();
  const grouped = groups.flatMap((group) => {
    const rows = group.itemIds.flatMap((id) => {
      const entity = byId.get(id);
      if (!entity || placed.has(id)) return [];
      placed.add(id);
      return [entity];
    });
    return rows.length ? [{ label: group.label, entities: rows }] : [];
  });
  const rest = entities.filter((entity) => !placed.has(entity.id));
  return rest.length ? [...grouped, { entities: rest }] : grouped;
}

function Rows(props: ListProps) {
  const query = createMemo<Query>(() => {
    const src = props.source;
    return src.kind === 'items' ? refsToQuery(src.entities) : src.query;
  });

  // `items` mode with zero resolvable refs would otherwise NIL-fill everything
  // and return nothing — which is the correct "No items." outcome anyway.
  // `groupBy` orders the returned entities by the requested facet (the grouped
  // select flattens groups into `data.entities` in group order).
  const notificationSource = useGlobalNotificationSource();
  const itemsQuery = useSoupAstItemsQuery(
    () => ({
      params: { limit: 200 },
      body: compileQuery(query()),
      groupBy: props.groupBy ? GROUP_BY_BY_NAME[props.groupBy] : undefined,
    }),
    () => {
      // Unlike the soup view, this query has no client `itemFilter`, so the
      // normalized cache would prepend ANY optimistically/WS-inserted entity
      // into it (a new task landing in an email-scoped list, etc.). Gate inserts
      // on the same `Query` that produced the AST so only matching items appear.
      return { meta: { itemFilter: queryItemFilter(query()) } };
    }
  );

  const entities = createMemo(() => {
    const all = itemsQuery.data?.entities ?? [];
    const sliced = props.limit != null ? all.slice(0, props.limit) : all;
    // Soup rows carry raw notification arrays; ListEntity reads an accessor.
    return sliced.map((entity) =>
      withEntityNotifications(entity, notificationSource)
    );
  });
  const count = () => entities().length;
  const counted = () => `${count()} ${count() === 1 ? 'item' : 'items'}`;

  return (
    <CollectionCard
      title={props.title ?? counted()}
      subtitle={props.title ? counted() : undefined}
      icon={collectionIcon(entities())}
      count={count()}
      live={props.source.kind === 'query'}
      state="ready"
    >
      <For each={sections(entities(), itemsQuery.data?.groups)}>
        {(section) => (
          <Show
            when={props.groupBy && section.label}
            fallback={
              <For each={section.entities}>
                {(entity) => <Row entity={entity} />}
              </For>
            }
          >
            {(label) => (
              <CollectionGroup label={label()}>
                <For each={section.entities}>
                  {(entity) => <Row entity={entity} />}
                </For>
              </CollectionGroup>
            )}
          </Show>
        )}
      </For>
    </CollectionCard>
  );
}

/**
 * Many workspace items as one collection card. Rows are the unified list's
 * own, live from the soup query; a long list holds a fixed height and says
 * how much is below it, and while the query loads the card keeps its
 * height with skeleton rows.
 */
export function List(props: ListProps) {
  return (
    <ListEntityMetadataQueryProvider>
      <ListLayoutProvider ref={() => undefined}>
        {/* Soup fetches suspend; guard so it can't blank the surrounding view. */}
        <Suspense
          fallback={
            <CollectionCard
              title={props.title ?? 'Items'}
              count={0}
              live={props.source.kind === 'query'}
              state="loading"
            />
          }
        >
          <Rows {...props} />
        </Suspense>
      </ListLayoutProvider>
    </ListEntityMetadataQueryProvider>
  );
}
