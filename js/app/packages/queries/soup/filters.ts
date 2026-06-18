import type { EntityFilters } from '@service-storage/generated/schemas/entityFilters';

/**
 * The all-zero UUID. No real entity has this id, so an id filter pinned to it
 * matches nothing — the canonical way to exclude an entity type from a soup
 * query (soup has no explicit "exclude this type" primitive).
 */
export const NIL_ID = '00000000-0000-0000-0000-000000000000';

/**
 * Keys of {@link EntityFilters} that each add an entity-type fan-out to a soup
 * query. `property_filters` is intentionally excluded: it refines the other
 * types rather than contributing a fan-out of its own.
 */
type EntityTypeFilterKey = Exclude<keyof EntityFilters, 'property_filters'>;

/**
 * A soup filter that excludes every entity type (each type's id list pinned to
 * {@link NIL_ID}).
 *
 * Soup is include-by-default: a type with no filter returns its whole feed,
 * including the "side" fan-outs (foreign entities, crm companies) the backend
 * runs unfiltered. A scoped query — e.g. resolving a known set of channel
 * attachments — wants only the types it asks for, so it must suppress all the
 * rest. Use {@link scopedEntityFilters} to spread this and override the types
 * you want.
 *
 * Typed as a fully-required mapped type so adding a new fan-out key to
 * {@link EntityFilters} fails to compile until it's handled here (or explicitly
 * added to the excluded keys above). That's what stops a new soup type from
 * silently leaking into — and slowing down — every scoped query.
 */
const EXCLUDE_ALL_ENTITY_FILTERS: {
  [K in EntityTypeFilterKey]-?: NonNullable<EntityFilters[K]>;
} = {
  document_filters: { document_ids: [NIL_ID] },
  email_filters: { email_thread_ids: [NIL_ID] },
  chat_filters: { chat_ids: [NIL_ID] },
  channel_filters: { channel_ids: [NIL_ID] },
  project_filters: { project_ids: [NIL_ID] },
  call_filters: { call_ids: [NIL_ID] },
  crm_company_filters: { company_ids: [NIL_ID] },
  foreign_entity_filters: { ids: [NIL_ID] },
};

/**
 * Build a soup filter scoped to only the entity types named in `overrides`;
 * every other type is excluded. Returns a fresh object each call.
 */
export function scopedEntityFilters(overrides: EntityFilters): EntityFilters {
  return { ...EXCLUDE_ALL_ENTITY_FILTERS, ...overrides };
}
