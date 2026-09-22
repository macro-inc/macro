import { NIL_UUID, type TagFacetContext } from '@app/features/soup/filters';
import type { SoupSearchMatchType } from '@app/features/soup/search';
import type { SearchSoupQueryArgs } from '@queries/soup/search';
import type {
  DocumentFilters,
  EntityFilters,
} from '@service-search/generated/models';
import type { DriveSelection } from '../context/drive-source';
import { driveSearchFileTypes } from '../filters/drive-facets';

export type BuildDriveSearchRequestOptions = {
  selection: DriveSelection;
  userId: string | undefined;
  facetContext: TagFacetContext;
  query: string;
  matchType: SoupSearchMatchType;
};

function excludedEntityFilters(): EntityFilters {
  return {
    agent_session_filters: { ids: [NIL_UUID] },
    calendar_event_filters: { calendar_event_ids: [NIL_UUID] },
    call_filters: { call_ids: [NIL_UUID] },
    channel_filters: { channel_ids: [NIL_UUID] },
    channel_thread_filters: { thread_ids: [NIL_UUID] },
    chat_filters: { chat_ids: [NIL_UUID] },
    crm_company_filters: { company_ids: [NIL_UUID] },
    document_filters: { document_ids: [NIL_UUID] },
    email_filters: { email_thread_ids: [NIL_UUID] },
    foreign_entity_filters: { ids: [NIL_UUID] },
    project_filters: { project_ids: [NIL_UUID] },
    reminder_filters: { ids: [NIL_UUID] },
  };
}

function attachmentFilter(selection: DriveSelection): boolean | undefined {
  if (selection.scope === 'default') return false;
  if (selection.scope === 'attachments') return true;

  return undefined;
}

function selectedCreators(selection: DriveSelection): string[] | undefined {
  const creators = [...new Set(selection.facets['created-by'] ?? [])];

  if (creators.length === 0) return undefined;

  return creators;
}

function documentOwners(
  selection: DriveSelection,
  userId: string | undefined
): string[] | undefined {
  const creators = selectedCreators(selection);

  const location = selection.location;

  if (location.kind !== 'tab') return creators;

  if (location.tab === 'owned' && selection.scope === 'default') {
    if (!userId) return [NIL_UUID];
    if (creators && !creators.includes(userId)) return [NIL_UUID];

    return [userId];
  }

  if (location.tab === 'shared') {
    if (!userId) return [NIL_UUID];

    if (creators) {
      const others = creators.filter((id) => id !== userId);

      return others.length > 0 ? others : [NIL_UUID];
    }
  }

  return creators;
}

function documentFilters(
  selection: DriveSelection,
  userId: string | undefined
): DocumentFilters {
  const filters: DocumentFilters = {};

  const attachment = attachmentFilter(selection);

  if (attachment !== undefined) {
    filters.is_email_attachment = attachment;
  }

  const owners = documentOwners(selection, userId);

  if (owners) filters.owners = owners;

  const fileTypes = driveSearchFileTypes(selection.facets.type ?? []);

  if (fileTypes) filters.file_types = fileTypes;

  return filters;
}

function applyTags(
  filters: EntityFilters,
  selection: DriveSelection,
  facetContext: TagFacetContext
): void {
  const selected = [...new Set(selection.facets.tags ?? [])];

  const resolved = selected.filter((id) =>
    facetContext.tagPropertyDefinitionByOptionId.has(id)
  );
  if (resolved.length === 0) return;

  filters.tag_option_ids = resolved;
  filters.tag_filter_mode = 'any';
}

function filtersForSelection(
  selection: DriveSelection,
  userId: string | undefined,
  facetContext: TagFacetContext
): EntityFilters {
  const filters = excludedEntityFilters();

  const location = selection.location;

  const creators = selectedCreators(selection);

  if (location.kind === 'tab') {
    filters.document_filters = documentFilters(selection, userId);
  } else if (location.id === null) {
    filters.project_filters = {};

    if (creators) filters.project_filters.owners = creators;
  } else {
    const documents = documentFilters(selection, userId);

    documents.project_ids = [location.id];
    filters.document_filters = documents;

    filters.chat_filters = { project_ids: [location.id] };
    filters.project_filters = { project_ids: [location.id] };

    if (creators) {
      filters.chat_filters.owners = creators;
      filters.project_filters.owners = creators;
    }

    // Email search has no owner field, so creator selection is completed by
    // Drive's client predicate after fetching the folder-scoped candidates.
    filters.email_filters = { project_ids: [location.id] };
  }

  // Finite file-type and creator refinements narrow service pages. Negative
  // subtype/ownership constraints still need Drive's exact client predicates;
  // the list continues loading short filtered pages.
  applyTags(filters, selection, facetContext);

  return filters;
}

/** Builds the positive service-backed portion of Drive text search. */
export function buildDriveSearchRequest(
  options: BuildDriveSearchRequestOptions
): SearchSoupQueryArgs {
  return {
    params: { cursor: null, page_size: 100 },
    body: {
      query: options.query,
      match_type: options.matchType,
      search_on: 'name_content',
      filters: filtersForSelection(
        options.selection,
        options.userId,
        options.facetContext
      ),
    },
  };
}
