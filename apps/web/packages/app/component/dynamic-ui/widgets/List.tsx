import {
  compileToAst,
  defineQueryFilters,
  type Query,
  queryStateFrom,
} from '@app/component/next-soup/filters/filter-store';
import type { FieldFilters } from '@app/component/next-soup/filters/filter-store/types';
import { CollapsibleList } from '@entity/components/CollapsibleList';
import { ListEntity, ListLayoutProvider } from '@entity/composed/ListEntity';
import type { EntityData } from '@entity/types/entity';
import type { WithNotification } from '@entity/types/notification';
import type { GroupByField } from '@queries/soup/grouped/types';
import {
  type SoupAstItemsQueryArgs,
  useSoupAstItemsQuery,
} from '@queries/soup/items';
import { cn } from '@ui';
import { createMemo, Show, Suspense } from 'solid-js';
import type { EntityRef, WidgetOf } from '../schema';
import { SURFACE, TEXT } from '../tokens';

/**
 * A list of workspace items, styled to match SoupView's grouped "card view":
 * a bold group header above a rounded card of rows, with a "Show N More" footer.
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
 * provider `ListEntity` needs for the wide layout is `ListLayoutProvider`
 * (width detection); `Entity.Properties` brings its own `PropertiesProvider`,
 * and the split-panel / soup-view contexts are read optionally so they degrade
 * gracefully when absent. We render inside the gallery's split-panel anyway.
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

/** Map a schema `EntityRef.type` onto the soup `FieldFilters` id field. */
const ID_FIELD_BY_TYPE: Partial<Record<EntityRef['type'], IdFieldName>> = {
  document: 'documentId',
  chat: 'chatId',
  channel: 'channelId',
  project: 'folderId',
  email_thread: 'threadId',
  call: 'callId',
  foreign_entity: 'foreignEntityRecordId',
  crm_company: 'crmCompanyId',
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

/**
 * One row: a real `ListEntity`, rendered flush the way SoupView / the unified
 * list do. The row's own `Entity.Root` supplies its height, the rounded inset
 * `bg-hover/30` highlight pill (`w-[calc(100%-0.5rem)] mx-1`), and hover state —
 * so it must sit in a flush container, NOT a bordered/`divide-y` card, or the
 * pill ends up boxed in by per-row dividers. `hideCheckbox` drops the
 * multi-select checkbox (read-only embed), leaving just the icon / unread dot.
 */
function Row(props: { entity: EntityData }) {
  return (
    <ListEntity
      entity={props.entity as WithNotification<EntityData>}
      hideCheckbox
    />
  );
}

function Rows(props: {
  source: ListProps['source'];
  limit?: number;
  groupBy?: ListProps['groupBy'];
}) {
  const query = createMemo<Query>(() => {
    const src = props.source;
    return src.kind === 'items' ? refsToQuery(src.entities) : src.query;
  });

  // `items` mode with zero resolvable refs would otherwise NIL-fill everything
  // and return nothing — which is the correct "No items." outcome anyway.
  // `groupBy` orders the returned entities by the requested facet (the grouped
  // select flattens groups into `data.entities` in group order).
  const itemsQuery = useSoupAstItemsQuery(() => ({
    params: { limit: 200 },
    body: compileQuery(query()),
    groupBy: props.groupBy ? GROUP_BY_BY_NAME[props.groupBy] : undefined,
  }));

  const entities = createMemo<EntityData[]>(() => {
    const all = itemsQuery.data?.entities ?? [];
    return props.limit != null ? all.slice(0, props.limit) : all;
  });

  return (
    <Show
      when={entities().length > 0}
      fallback={
        <div class={cn('px-3 py-6 text-center text-sm', TEXT.tertiary)}>
          No items.
        </div>
      }
    >
      <CollapsibleList
        items={entities()}
        visibleCount={3}
        togglePosition="bottom"
      >
        {(entity) => <Row entity={entity} />}
      </CollapsibleList>
    </Show>
  );
}

export function List(props: ListProps) {
  return (
    <ListLayoutProvider ref={() => undefined}>
      <div class="flex w-full min-w-0 flex-col gap-2">
        {/* Group header, soup-style: bold title above the card. */}
        <Show when={props.title}>
          {(title) => (
            <div
              class={cn(
                'flex items-center gap-2 px-1 text-sm font-semibold',
                TEXT.primary
              )}
            >
              {title()}
            </div>
          )}
        </Show>

        {/*
         * Flush row container (mirrors SoupView's unified list): no
         * per-row dividers/borders. Each `ListEntity` brings its own
         * rounded inset highlight pill (`mx-1`), so the card just needs a
         * hair of vertical padding for the pills to breathe — adding
         * `divide-y`/per-row borders here would box those highlights in.
         */}
        <div
          class={cn(
            'overflow-hidden rounded-lg border py-1',
            SURFACE.borderMuted
          )}
        >
          {/* Soup fetches suspend; guard so it can't blank the surrounding view. */}
          <Suspense
            fallback={
              <div class={cn('px-3 py-6 text-center text-sm', TEXT.tertiary)}>
                Loading…
              </div>
            }
          >
            <Rows
              source={props.source}
              limit={props.limit}
              groupBy={props.groupBy}
            />
          </Suspense>
        </div>
      </div>
    </ListLayoutProvider>
  );
}
