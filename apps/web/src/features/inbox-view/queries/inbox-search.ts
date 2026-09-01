import {
  type FacetSelection,
  NIL_UUID,
  type SoupSearchRequest,
} from '@app/features/soup';
import type { SearchSoupQueryArgs } from '@queries/soup/search';
import type {
  EntityFilters,
  NotificationFilters,
} from '@service-search/generated/models';
import type { InboxTab, InboxTypeFilter } from '../types';
import type { InboxQueryCapabilities, InboxViewContext } from './inbox-query';

const tabTypes: Record<InboxTab, ReadonlySet<InboxTypeFilter>> = {
  signal: new Set([
    'documents',
    'tasks',
    'email',
    'channels',
    'agents',
    'projects',
    'github',
    'reminders',
    'calendar',
  ]),
  noise: new Set(['email']),
  all: new Set([
    'documents',
    'tasks',
    'email',
    'channels',
    'agents',
    'projects',
    'github',
  ]),
  reminders: new Set(['reminders']),
};

function readFilter(
  selection: FacetSelection
): NotificationFilters | undefined {
  const active = selection.read ?? [];
  if (active.length !== 1) return undefined;
  if (active[0] === 'read') return { seen: true };
  if (active[0] === 'unread') return { seen: false };

  return undefined;
}

function resolveTypes(
  tab: InboxTab,
  selection: FacetSelection,
  capabilities: InboxQueryCapabilities
): ReadonlySet<InboxTypeFilter> {
  const selected = new Set(selection.type ?? []);
  const requested =
    selected.size === 0
      ? tabTypes[tab]
      : new Set([...tabTypes[tab]].filter((type) => selected.has(type)));

  return new Set(
    [...requested].filter((type) => {
      if (type === 'calendar') return capabilities.calendar;
      if (type === 'github') return capabilities.foreignEntities;
      if (type === 'reminders') return capabilities.reminders;
      return true;
    })
  );
}

/** Mirrors Inbox tab/type/read semantics for service-backed search. */
export function buildInboxSearchRequest(
  context: InboxViewContext,
  search: SoupSearchRequest
): SearchSoupQueryArgs {
  const types = resolveTypes(context.tab, context.facets, context.capabilities);
  const notification = readFilter(context.facets);

  const filtersIncompleteEntities =
    context.tab === 'signal' || context.tab === 'noise';

  const notificationFilters: NotificationFilters = {};

  if (filtersIncompleteEntities) {
    notificationFilters.done = false;
  }

  if (notification?.seen !== undefined) {
    notificationFilters.seen = notification.seen;
  }

  const documentTypes = [...types].filter(
    (type) => type === 'documents' || type === 'tasks'
  );

  const hasNotificationFilter =
    filtersIncompleteEntities || notification !== undefined;

  const filters: EntityFilters = {
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

  if (types.has('calendar')) {
    filters.calendar_event_filters = {};
  }

  if (types.has('channels')) {
    const channelFilters: NonNullable<EntityFilters['channel_filters']> = {};

    if (context.tab === 'signal') {
      channelFilters.is_participant = true;
    }

    if (hasNotificationFilter) {
      channelFilters.notification_filters = notificationFilters;
    }

    filters.channel_filters = channelFilters;
  }

  if (types.has('channels')) {
    filters.channel_thread_filters = {
      participant_ids: [context.userId ?? NIL_UUID],
    };
  }

  if (types.has('agents')) {
    const chatFilters: NonNullable<EntityFilters['chat_filters']> = {};

    if (hasNotificationFilter) {
      chatFilters.notification_filters = notificationFilters;
    }

    filters.chat_filters = chatFilters;
  }

  if (documentTypes.length > 0) {
    const documentFilters: NonNullable<EntityFilters['document_filters']> = {};

    if (documentTypes.length === 1 && documentTypes[0] === 'tasks') {
      documentFilters.sub_types = ['task'];
    }

    if (hasNotificationFilter) {
      documentFilters.notification_filters = notificationFilters;
    }

    filters.document_filters = documentFilters;
  }

  if (types.has('email')) {
    const emailFilters: NonNullable<EntityFilters['email_filters']> = {
      shared: 'exclude',
    };

    if (context.tab === 'signal') {
      emailFilters.importance = true;
    }

    if (context.tab === 'noise') {
      emailFilters.importance = false;
    }

    if (hasNotificationFilter) {
      emailFilters.notification_filters = notificationFilters;
    }

    filters.email_filters = emailFilters;
  }

  if (types.has('github')) {
    const foreignEntityFilters: NonNullable<
      EntityFilters['foreign_entity_filters']
    > = {
      foreign_entity_sources: ['github_pull_request'],
      includes_me: true,
    };

    if (hasNotificationFilter) {
      foreignEntityFilters.notification_filters = notificationFilters;
    }

    filters.foreign_entity_filters = foreignEntityFilters;
  }

  if (types.has('projects')) {
    const projectFilters: NonNullable<EntityFilters['project_filters']> = {};

    if (hasNotificationFilter) {
      projectFilters.notification_filters = notificationFilters;
    }

    filters.project_filters = projectFilters;
  }

  if (types.has('reminders')) {
    const reminderFilters: NonNullable<EntityFilters['reminder_filters']> = {
      include: true,
    };

    if (context.tab === 'reminders') {
      reminderFilters.completed = false;
      reminderFilters.fired = false;
    }

    filters.reminder_filters = reminderFilters;
  }

  return {
    params: { cursor: null, page_size: 100 },
    body: {
      query: search.query,
      match_type: search.matchType,
      search_on: 'name_content',
      filters,
    },
  };
}
