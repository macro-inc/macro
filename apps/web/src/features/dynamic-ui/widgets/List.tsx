import {
  CollectionCard,
  CollectionGroup,
} from '@app/features/agent-cards/components/collection';
import {
  type LoadableType,
  useReferenceItem,
} from '@app/features/agent-cards/components/reference-card';
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
import {
  EntityIcon,
  type EntityIconSelector,
} from '@core/component/EntityIcon';
import { ListEntityMetadataQueryProvider } from '@entity';
import { ListEntity, ListLayoutProvider } from '@entity/composed/ListEntity';
import { Entity } from '@entity/entity';
import { type EntityData, isTaskEntity } from '@entity/types/entity';
import type { WithNotification } from '@entity/types/notification';
import type { GroupByField, GroupMeta } from '@queries/soup/grouped/types';
import {
  type SoupApiItemFilter,
  type SoupAstItemsQueryArgs,
  useSoupAstItemsQuery,
} from '@queries/soup/items';
import { formatDocumentName } from '@service-storage/util/filename';
import { cn } from '@ui';
import { createMemo, For, type JSX, Show, Suspense } from 'solid-js';
import type { EntityRef, WidgetOf } from '../view';
import { TaskResultRow } from './TaskResultRow';

/**
 * A list of workspace items, as an agent collection card: a header with the
 * title and count, the rows, group headers when grouped, and a fixed height
 * with "N more below" once the list is long.
 *
 * ── Real unified-list rows ───────────────────────────────────────────────────
 * Tasks use {@link TaskResultRow} with a wrapping title above live properties
 * and the timestamp. Other items retain the unified list’s {@link ListEntity}.
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
 *    A ref the query does not return - a kind soup cannot filter by id, like a
 *    database, or an item it has not indexed yet, deleted, or out of the
 *    viewer's reach - still shows, as a {@link ReferenceRow} loaded by id. An
 *    items list never reads "Nothing matches", and one with no refs is not drawn.
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
  // user / team / crm_contact / static_file have no soup item filter; an
  // items list still shows them, as rows loaded by id.
};

/** The card kind a ref the soup query did not return loads as, by id. */
const REFERENCE_TYPE_BY_TYPE: Partial<Record<EntityRef['type'], LoadableType>> =
  {
    document: 'document',
    database: 'database',
    email: 'email_thread',
    email_thread: 'email_thread',
    project: 'project',
    channel: 'channel',
    routine: 'routine',
    form: 'form',
    initiative: 'initiative',
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

/** Keep task titles readable while retaining live properties and split navigation. */
function Row(props: { entity: WithNotification<EntityData> }) {
  const notificationSource = useGlobalNotificationSource();
  const open = () =>
    openEntityInSplitFromUnifiedList(props.entity, { notificationSource });
  return (
    <div data-card-row class="min-w-0">
      <Show
        when={isTaskEntity(props.entity) && props.entity}
        fallback={
          <ListEntity entity={props.entity} hideCheckbox onClick={open} />
        }
      >
        {(task) => (
          <TaskResultRow
            title={formatDocumentName(task().name, task().fileType, {
              fullyQualifiedBlockName: true,
            })}
            icon={<Entity.Icon entity={task()} />}
            metadata={<Entity.Properties entity={task()} />}
            timestamp={<Entity.Timestamp entity={task()} />}
            onOpen={open}
          />
        )}
      </Show>
    </div>
  );
}

/** A row with its icon, title and a line about it, opening when it can. */
function PlainRow(props: {
  icon: EntityIconSelector;
  title: string;
  meta: string;
  onOpen?: (event: MouseEvent) => void;
  muted?: boolean;
  deleted?: boolean;
}) {
  const body = (): JSX.Element => (
    <>
      <span class="mt-0.5 size-4 shrink-0">
        <EntityIcon targetType={props.icon} size="sm" />
      </span>
      <span class="min-w-0 flex-1">
        <span
          class={cn(
            'block truncate text-sm font-medium',
            props.deleted && 'line-through'
          )}
        >
          {props.title}
        </span>
        <span class="mt-1 block truncate text-xs text-ink-extra-muted">
          {props.meta}
        </span>
      </span>
    </>
  );
  return (
    <div data-card-row class="min-w-0">
      <Show
        when={props.onOpen}
        fallback={
          <div
            class={cn(
              'mx-1 flex min-w-0 items-start gap-2 rounded-xl px-2 py-2',
              props.muted && 'opacity-60'
            )}
          >
            {body()}
          </div>
        }
      >
        {(onOpen) => (
          <button
            type="button"
            class={cn(
              'mx-1 flex w-full min-w-0 items-start gap-2 rounded-xl px-2 py-2 text-left touch:min-h-[44px] not-touch:hover:bg-list-hover focus-visible:bg-list-hover'
            )}
            aria-label={`Open ${props.title}`}
            onClick={(event) => onOpen()(event)}
          >
            {body()}
          </button>
        )}
      </Show>
    </div>
  );
}

/** A ref loaded by id with the viewer's own access; never shows what they cannot see. */
function LoadedReferenceRow(props: { type: LoadableType; id: string }) {
  const item = useReferenceItem(() => props);
  return (
    <PlainRow
      icon={item.icon()}
      title={item.title()}
      meta={item.meta()}
      onOpen={item.open()}
      muted={item.muted()}
      deleted={item.deleted()}
    />
  );
}

/** A kind of item, as a reader would name it: `crm_contact` → `Crm contact`. */
function kindLabel(type: EntityRef['type']): string {
  const words = type.replaceAll('_', ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * A ref the soup query did not return. A kind cards can load shows by id; any
 * other kind still shows, as an unavailable row, so no ref is dropped.
 */
function ReferenceRow(props: { entity: EntityRef }) {
  return (
    <Show
      when={REFERENCE_TYPE_BY_TYPE[props.entity.type]}
      fallback={
        <PlainRow
          icon="default"
          title={kindLabel(props.entity.type)}
          meta="Can't be shown here"
          muted
        />
      }
    >
      {(type) => <LoadedReferenceRow type={type()} id={props.entity.id} />}
    </Show>
  );
}

/** The icon a collection's header takes: the rows' own kind, or a mix. */
function collectionIcon(kinds: readonly string[]): EntityIconSelector {
  const kind = kinds[0];
  if (!kind || kinds.some((other) => other !== kind)) return 'files';
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

  // `items` mode with no soup-filterable refs NIL-fills everything and returns
  // nothing; those refs then show as rows loaded by id (`unresolved` below).
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
  // Every ref an items list names shows: the ones soup did not return load
  // by id instead of going missing.
  // Until soup answers, nothing is known to be missing.
  const unresolved = createMemo(() => {
    const source = props.source;
    const soupEntities = itemsQuery.data?.entities;
    if (source.kind !== 'items' || !soupEntities) return [];
    const returnedIds = new Set(soupEntities.map((entity) => entity.id));
    const seenRefs = new Set<string>();
    const missing = source.entities.filter((ref) => {
      const key = `${ref.type}:${ref.id}`;
      if (returnedIds.has(ref.id) || seenRefs.has(key)) return false;
      seenRefs.add(key);
      return true;
    });
    const rowsLeft =
      props.limit != null
        ? Math.max(0, props.limit - entities().length)
        : missing.length;
    return missing.slice(0, rowsLeft);
  });
  const count = () => entities().length + unresolved().length;
  const counted = () => `${count()} ${count() === 1 ? 'item' : 'items'}`;

  return (
    <CollectionCard
      title={props.title ?? counted()}
      subtitle={props.title ? counted() : undefined}
      icon={collectionIcon([
        ...entities().map((entity) => entity.type),
        ...unresolved().map((ref) => ref.type),
      ])}
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
      <For each={unresolved()}>{(ref) => <ReferenceRow entity={ref} />}</For>
    </CollectionCard>
  );
}

/**
 * Many workspace items as one collection card. Rows use live soup data with
 * wrapping task titles; a long list holds a fixed height and says
 * how much is below it, and while the query loads the card keeps its
 * height with skeleton rows.
 */
export function List(props: ListProps) {
  const empty = () =>
    props.source.kind === 'items' && props.source.entities.length === 0;
  return (
    <Show when={!empty()}>
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
    </Show>
  );
}
