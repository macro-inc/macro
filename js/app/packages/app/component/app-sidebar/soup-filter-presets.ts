import type { SIDEBAR_LINKS } from '@app/component/app-sidebar/sidebar';
import {
  EXCLUDE,
  QUERY_FILTERS,
  type FilterID,
} from '@app/component/next-soup/filters/filters';
import { applyInboxQueryFilters } from '@app/component/next-soup/filters/inbox-query-filters';
import type { SoupItemsQueryFilters } from '@queries/soup/items';

type Links = (typeof SIDEBAR_LINKS)[number]['href'];

type SoupFiltersPreset = {
  queryFilters: SoupItemsQueryFilters;
  clientFilters: FilterID[];
};

export const SOUP_FILTERS_PRESETS: Record<Links, SoupFiltersPreset> = {
  '/inbox': {
    queryFilters: applyInboxQueryFilters({}),
    clientFilters: ['signal', 'not-done'],
  },
  '/agents': {
    queryFilters: QUERY_FILTERS.agent,
    clientFilters: ['agent'],
  },
  '/mail': {
    queryFilters: QUERY_FILTERS.email,
    clientFilters: ['email'],
  },
  '/documents': {
    queryFilters: QUERY_FILTERS.document,
    clientFilters: ['document'],
  },
  '/tasks': {
    queryFilters: QUERY_FILTERS.task,
    clientFilters: ['task'],
  },
  '/channels': {
    queryFilters: QUERY_FILTERS.channels,
    clientFilters: ['channels'],
  },
  // Files view contains boths files and projects/folders
  '/files': {
    queryFilters: {
      chat_filters: { chat_ids: EXCLUDE },
      document_filters: { document_ids: EXCLUDE },
      email_filters: { recipients: EXCLUDE },
      project_filters: {},
      channel_filters: {},
    },
    clientFilters: [],
  },
};
