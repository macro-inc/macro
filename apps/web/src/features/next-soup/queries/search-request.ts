import {
  NIL_UUID,
  type QueryState,
} from '@app/features/next-soup/filters/filter-store';
import type { SoupSearchRequest } from '@app/features/soup/search';
import type {
  EntityFilters,
  PropertyFilter,
  UnifiedSearchRequest,
} from '@service-search/generated/models';
import { agentSessionSearchFilters } from './agent-session-search-filters';

// Map the tasks-view property filters (status/priority/assignee/custom) into the
// search request shape, mirroring the soup path so search and soup agree. Values
// are grouped by property id: multiple values on one property are OR'd (a task
// matches any of them), and different properties are AND'd. Select options go to
// option_ids, entity refs to entity_ids.
function includePropertiesToFilters(
  properties: QueryState['include']['properties']
): PropertyFilter[] {
  if (!properties?.length) return [];
  const byPropId = new Map<string, PropertyFilter>();
  for (const p of properties) {
    let filter = byPropId.get(p.propertyId);
    if (!filter) {
      filter = { property_definition_id: p.propertyId };
      byPropId.set(p.propertyId, filter);
    }
    if (p.type === 'select') {
      filter.option_ids = [...(filter.option_ids ?? []), p.value];
    } else {
      filter.entity_ids = [...(filter.entity_ids ?? []), p.value];
    }
  }
  return [...byPropId.values()];
}

type SearchInclude = QueryState['include'];

// Calendar events are searchable by title, so they are scoped like every
// other entity type: a view that names ids gets them, one that names none
// leaves the type unfiltered. Views that should not surface events keep
// NIL-excluding them (the inbox feed does), and every view's client
// predicates gate the merged pool regardless.
function calendarEventFilters(include: SearchInclude): EntityFilters {
  if (!include.calendarEventId?.length) return {};
  return {
    calendar_event_filters: { calendar_event_ids: include.calendarEventId },
  };
}

function documentFilters(include: SearchInclude): EntityFilters {
  if (
    !include.documentId?.length &&
    !include.fileType?.length &&
    !include.subType?.length &&
    !include.projectId?.length &&
    !include.documentOwnerId?.length
  )
    return {};
  return {
    document_filters: {
      document_ids: include.documentId,
      file_types: include.fileType,
      sub_types: include.subType,
      project_ids: include.projectId,
      owners: include.documentOwnerId,
    },
  };
}

function emailFilters(include: SearchInclude): EntityFilters {
  if (
    !include.threadId?.length &&
    !include.emailSender?.length &&
    !include.emailShared &&
    include.emailImportance === undefined &&
    !include.emailLinkId?.length
  )
    return {};
  return {
    email_filters: {
      email_thread_ids: include.threadId,
      senders: include.emailSender,
      shared: include.emailShared,
      importance: include.emailImportance,
      link_ids: include.emailLinkId,
    },
  };
}

function channelFilters(include: SearchInclude): EntityFilters {
  if (
    !include.channelId?.length &&
    !include.channelType?.length &&
    !include.channelSenderId?.length &&
    !include.channelMessageThreadId?.length
  )
    return {};
  return {
    channel_filters: {
      channel_ids: include.channelId,
      channel_types: include.channelType,
      sender_ids: include.channelSenderId,
      thread_ids: include.channelMessageThreadId,
    },
  };
}

function channelThreadFilters(include: SearchInclude): EntityFilters {
  if (
    !include.channelThreadId?.length &&
    !include.channelThreadRootSenderId?.length &&
    !include.channelThreadParticipantId?.length
  )
    return {};
  return {
    channel_thread_filters: {
      thread_ids: include.channelThreadId,
      root_sender_ids: include.channelThreadRootSenderId,
      participant_ids: include.channelThreadParticipantId,
    },
  };
}

function chatFilters(include: SearchInclude): EntityFilters {
  if (
    !include.chatId?.length &&
    !include.chatOwnerId?.length &&
    !include.chatProjectId?.length
  )
    return {};
  return {
    chat_filters: {
      chat_ids: include.chatId,
      owners: include.chatOwnerId,
      project_ids: include.chatProjectId,
    },
  };
}

function projectFilters(include: SearchInclude): EntityFilters {
  if (!include.folderId?.length && !include.folderOwnerId?.length) return {};
  return {
    project_filters: {
      project_ids: include.folderId,
      owners: include.folderOwnerId,
    },
  };
}

function callFilters(include: SearchInclude): EntityFilters {
  if (
    !include.callId?.length &&
    !include.callChannelId?.length &&
    !include.callSpeakerId?.length &&
    include.callStatus === undefined &&
    include.callAttended === undefined
  )
    return {};
  return {
    call_filters: {
      call_ids: include.callId,
      channel_ids: include.callChannelId,
      speaker_ids: include.callSpeakerId,
      status: include.callStatus,
      attended:
        include.callStatus === undefined ? include.callAttended : undefined,
    },
  };
}

function foreignEntityFilters(include: SearchInclude): EntityFilters {
  if (
    !include.foreignEntityRecordId?.length &&
    !include.foreignEntitySource?.length
  )
    return {};
  return {
    foreign_entity_filters: {
      ids: include.foreignEntityRecordId,
      foreign_entity_sources: include.foreignEntitySource,
    },
  };
}

// Property filters (status, priority, assignees, custom)
function propertyFilters(include: SearchInclude): EntityFilters {
  const filters = includePropertiesToFilters(include.properties);
  return filters.length ? { property_filters: filters } : {};
}

// Tags: match on the option ids alone (globally unique), combined across
// all tag definitions. No definition id is sent — the backend matches
// values only. The mode picks any-of (default) vs all-of combining.
function tagFilters(include: SearchInclude): EntityFilters {
  if (!include.tagFilters?.length) return {};
  return {
    tag_option_ids: include.tagFilters.map((t) => t.value),
    ...(include.tagFilterMode === 'all' ? { tag_filter_mode: 'all' } : {}),
  };
}

function filterDataToQueryFilters({ include }: QueryState): EntityFilters {
  return {
    agent_session_filters: agentSessionSearchFilters(include),
    ...calendarEventFilters(include),
    ...documentFilters(include),
    ...emailFilters(include),
    ...channelFilters(include),
    ...channelThreadFilters(include),
    ...chatFilters(include),
    ...projectFilters(include),
    ...callFilters(include),
    ...foreignEntityFilters(include),
    ...propertyFilters(include),
    ...tagFilters(include),
  };
}

/** Shared full-text request mapping for Search surfaces. */
export function buildSoupSearchRequest(
  state: QueryState,
  { query, matchType }: SoupSearchRequest
): { params: { page_size: number }; body: UnifiedSearchRequest } {
  const baseFilters = filterDataToQueryFilters(state);

  // CRM is opt-in on the backend. A view includes CRM in search unless it
  // NIL-excludes the CRM target (the same sentinel pattern other entity
  // types use) — so the Companies view (CRM-scoped) searches CRM, while
  // every other view (including the global Search view) excludes it.
  const includeCrm = !(state.include.crmCompanyId ?? []).includes(NIL_UUID);
  const body: UnifiedSearchRequest = includeCrm
    ? {
        search_on: 'name_content',
        match_type: matchType,
        query,
        include_crm: true,
        filters: {
          ...baseFilters,
          crm_company_filters: {
            company_ids: state.include.crmCompanyId,
            hidden: state.include.crmCompanyHidden,
          },
        },
      }
    : {
        search_on: 'name_content',
        match_type: matchType,
        query,
        filters: baseFilters,
      };

  return { params: { page_size: 100 }, body };
}
