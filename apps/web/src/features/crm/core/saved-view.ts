/** Snapshot of the Customers view state. Fields are all optional so old
 * links/views keep working as the shape evolves. */
export type CrmViewConfig = {
  kind: 'crm';
  /** Server query filters (soup `Query`). */
  filters?: unknown;
  /** Client predicate ids ({ and, or }). */
  clientFilters?: { and?: string[]; or?: string[] };
  searchText?: string;
  /** Group-by id (e.g. `property:<definition-id>`); null = no grouping. */
  groupBy?: string | null;
  /** Sort ids (soup sort state). */
  sort?: string[];
  /** Stage option ids selected in the Stage filter (may include NO_STAGE). */
  stageFilter?: string[];
  /** Owner ids selected in the Owner filter. */
  ownerFilter?: string[];
  activeTab?: string;
  /** Personal views only: applied by default when opening the Customers view. */
  isDefault?: boolean;
};

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const optionalStrings = (value: unknown): boolean =>
  value === undefined ||
  (Array.isArray(value) && value.every((item) => typeof item === 'string'));
/** Accept older snapshots and future fields, but never install malformed known state. */
export function isCrmViewConfig(value: unknown): value is CrmViewConfig {
  if (!record(value) || value.kind !== 'crm') return false;
  if (
    value.filters !== undefined &&
    value.filters !== null &&
    !record(value.filters)
  )
    return false;
  if (
    value.clientFilters !== undefined &&
    (!record(value.clientFilters) ||
      !optionalStrings(value.clientFilters.and) ||
      !optionalStrings(value.clientFilters.or))
  )
    return false;
  if (value.searchText !== undefined && typeof value.searchText !== 'string')
    return false;
  if (value.activeTab !== undefined && typeof value.activeTab !== 'string')
    return false;
  if (
    value.groupBy !== undefined &&
    value.groupBy !== null &&
    typeof value.groupBy !== 'string'
  )
    return false;
  if (value.isDefault !== undefined && typeof value.isDefault !== 'boolean')
    return false;
  return (
    optionalStrings(value.sort) &&
    optionalStrings(value.stageFilter) &&
    optionalStrings(value.ownerFilter)
  );
}
